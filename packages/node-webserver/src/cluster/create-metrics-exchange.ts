import { METRICS_TIMEOUT } from '../constants';
import type { FrontService, FrontServiceMessage, PrimaryMessage } from '../types';
import type { ServerMetrics } from '@koeroesi86/node-worker-express';

interface Member {
  send: (message: PrimaryMessage) => void;
  /** whether it said it listens */
  listens?: boolean;
  /** which front it is, and its process */
  process?: { front: number; pid: number };
}

interface Question {
  /** the fronts that did not answer yet */
  waiting: Set<Member>;
  answers: ServerMetrics[];
  finish: () => void;
}

/**
 * What the fronts of one set learn of each other through the primary: their processes, for the stats, and their metrics, which the primary asks all of them for when one of them
 * wants them. A front that does not answer in time is left out.
 */
const createMetricsExchange = (): FrontService => {
  const members = new Set<Member>();
  const questions = new Map<number, Question>();
  let asked = 0;

  const listening = () => Array.from(members).filter(({ listens }) => listens);

  const tellProcesses = () => {
    const processes = Object.fromEntries(Array.from(members).flatMap(({ process }) => (process ? [[process.front, process.pid]] : [])));
    listening().forEach(({ send }) => send({ nodeWebserver: 'processes', processes }));
  };

  const ask = (member: Member, id: number) => {
    const query = (asked += 1);
    const fronts = listening();
    const answers: ServerMetrics[] = [];
    const finish = () => {
      clearTimeout(timer);
      questions.delete(query);
      member.send({ nodeWebserver: 'metrics', id, answers });
    };
    const timer = setTimeout(finish, METRICS_TIMEOUT);
    questions.set(query, { waiting: new Set(fronts), answers, finish });
    fronts.forEach(({ send }) => send({ nodeWebserver: 'metrics-read', query }));
  };

  /** a front answered, or will not */
  const settle = (query: number, member: Member) => {
    const question = questions.get(query);
    if (question?.waiting.delete(member) && question.waiting.size === 0) question.finish();
  };

  const receive = (member: Member, message: FrontServiceMessage) => {
    if (message.nodeWebserver === 'metrics-wanted') return ask(member, message.id);
    if (message.nodeWebserver === 'metrics-read-done') {
      questions.get(message.query)?.answers.push(message.metrics);
      return settle(message.query, member);
    }
    if (message.nodeWebserver !== 'process') return;

    member.process = { front: message.front, pid: message.pid };
    tellProcesses();
  };

  return {
    join: (send) => {
      const member: Member = { send };
      members.add(member);

      return {
        hello: () => {
          member.listens = true;
        },
        receive: (message) => receive(member, message),
        serves: () => {},
        leave: () => {
          members.delete(member);
          Array.from(questions.keys()).forEach((query) => settle(query, member));
          if (member.process) tellProcesses();
        },
      };
    },
  };
};

export default createMetricsExchange;
