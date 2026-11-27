import { getAcmeFiles } from '../acme';
import { CHALLENGE_TIMEOUT } from '../constants';
import type { CertificateRegistry, CertificateServer, PrimaryMessage } from '../types';

interface Member {
  send: (message: PrimaryMessage) => void;
  /** whether it said it listens, and was told the challenges that wait */
  listens?: boolean;
  /** the `acme` servers it serves */
  servers: CertificateServer[];
}

interface Waiting {
  /** the fronts that did not say yet that they have the challenge */
  fronts: Set<Member>;
  done: () => void;
}

/**
 * What the primary knows about the certificates: the `acme` servers of its fronts, which they name, and the challenges of the orders that wait, which every front has to answer.
 * `onNewServer` is called for a server it did not hear of before.
 */
const createCertificateRegistry = (onNewServer: () => void): CertificateRegistry => {
  const members = new Set<Member>();
  const answers = new Map<string, string>();
  const waiting = new Map<string, Waiting>();
  const known = new Set<string>();

  const listening = () => Array.from(members).filter(({ listens }) => listens);

  const taken = (member: Member, token: string) => {
    const entry = waiting.get(token);
    entry?.fronts.delete(member);
    if (entry?.fronts.size === 0) entry.done();
  };

  const serves = (member: Member, servers: CertificateServer[]) => {
    member.servers = servers;
    const added = servers.map((server) => JSON.stringify(server)).filter((server) => !known.has(server));
    added.forEach((server) => known.add(server));
    if (added.length) onNewServer();
  };

  return {
    join: (send) => {
      const member: Member = { send, servers: [] };
      members.add(member);

      return {
        hello: () => {
          member.listens = true;
          answers.forEach((answer, token) => send({ nodeWebserver: 'challenge', token, answer }));
        },
        receive: (message) => message.nodeWebserver === 'challenge-taken' && taken(member, message.token),
        serves: ({ certificates }) => serves(member, certificates),
        leave: () => {
          members.delete(member);
          Array.from(waiting.keys()).forEach((token) => taken(member, token));
        },
      };
    },
    // one for each certificate file, as fronts with an older and a newer configuration may name it
    getServers: () => Array.from(new Map(Array.from(members).flatMap(({ servers }) => servers.map((server) => [getAcmeFiles(server).cert, server]))).values()),
    challenges: {
      /** resolves once every front has the answer, or after a while without the ones that say nothing */
      set: (token, answer) =>
        new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            waiting.delete(token);
            resolve();
          };
          const timer = setTimeout(done, CHALLENGE_TIMEOUT);
          const fronts = listening();
          answers.set(token, answer);
          waiting.set(token, { fronts: new Set(fronts), done });
          fronts.forEach(({ send }) => send({ nodeWebserver: 'challenge', token, answer }));
          if (!fronts.length) done();
        }),
      delete: (token) => {
        answers.delete(token);
        listening().forEach(({ send }) => send({ nodeWebserver: 'challenge', token }));
      },
    },
  };
};

export default createCertificateRegistry;
