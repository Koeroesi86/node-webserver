import { getServerMetrics } from '@koeroesi86/node-worker-express';
import type { ServerMetrics } from '@koeroesi86/node-worker-express';
import { METRICS_ANSWER_TIMEOUT } from '../constants';
import type { FrontMessage, PrimaryMessage } from '../types';

type MetricsMessage = Extract<PrimaryMessage, { nodeWebserver: 'metrics-read' | 'metrics' | 'processes' }>;

/**
 * The metrics of all fronts as one of them gets them: it asks the primary, which asks every front, and labels them by the number of the front. Its own are what is on top,
 * as the ones of a server of one process are.
 */
const createFrontMetrics = (index: number, send: (message: FrontMessage) => unknown, read: () => ServerMetrics = getServerMetrics) => {
  const front = index + 1;
  const waiting = new Map<number, (answers: ServerMetrics[]) => void>();
  let asked = 0;
  let processes: Record<string, number> = {};

  const combine = (answers: ServerMetrics[]): ServerMetrics => {
    const fronts = Object.fromEntries(answers.map(({ front: from, fronts: _, ...metrics }) => [from, metrics]));

    return { ...(fronts[front] ?? read()), front, fronts };
  };

  const collect = () =>
    new Promise<ServerMetrics>((resolve) => {
      const id = (asked += 1);
      const done = (answers: ServerMetrics[]) => {
        clearTimeout(timer);
        waiting.delete(id);
        resolve(combine(answers));
      };
      // a primary that says nothing leaves the worker with the numbers of this front
      const timer = setTimeout(done, METRICS_ANSWER_TIMEOUT, []);
      waiting.set(id, done);
      send({ nodeWebserver: 'metrics-wanted', id });
    });

  return {
    collect,
    /** of every front, by its number, as the primary said last */
    getProcesses: () => processes,
    receive: (message: MetricsMessage) => {
      if (message.nodeWebserver === 'metrics') return waiting.get(message.id)?.(message.answers);
      if (message.nodeWebserver === 'metrics-read') return send({ nodeWebserver: 'metrics-read-done', query: message.query, metrics: { ...read(), front } });
      processes = message.processes;
    },
  };
};

export default createFrontMetrics;
