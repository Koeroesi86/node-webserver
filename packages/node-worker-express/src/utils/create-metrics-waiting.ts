import { WORKER_EVENT } from '../constants';
import type { WorkerOutputEvent } from '../types';
import type { Channel } from './createChannel';
import type { RequestContexts } from './create-request-contexts';
import type { ServerMetrics } from './metrics';

/** the questions of the workers for the metrics of the server, which are answered in the order they were asked */
export default function createMetricsWaiting(contexts: RequestContexts, channel: Channel<WorkerOutputEvent>) {
  return {
    request: (requestId: string) =>
      new Promise<ServerMetrics>((resolve) => {
        contexts.open(requestId).metricsWaiting.push(resolve);
        channel.send({ type: WORKER_EVENT.METRICS_REQUEST, requestId });
      }),

    receive: (requestId: string, metrics: ServerMetrics) => {
      contexts.get(requestId)?.metricsWaiting.shift()?.(metrics);
      contexts.release(requestId);
    },

    /** the request is over, nothing will ask for metrics through it any more */
    clear: (requestId: string) =>
      contexts.change(requestId, (context) => {
        context.metricsWaiting.length = 0;
      }),
  };
}
