import type { InvokableWorker, WorkerOutputEvent } from '../types';
import type createHandOffRequests from './create-hand-off-requests';
import type createMetricsWaiting from './create-metrics-waiting';
import type { Channel } from './create-channel';
import type { RequestContexts } from './create-request-contexts';

/** what the units of a worker process share: the worker, the channel to the server, and the state of the requests in flight */
export interface WorkerEnvironment {
  worker: InvokableWorker;
  channel: Channel<WorkerOutputEvent>;
  /** whether the stream under the channel still takes writes, which tells a message that was too big from one sent into a closed channel */
  isWritable: () => boolean;
  contexts: RequestContexts;
  metrics: ReturnType<typeof createMetricsWaiting>;
  handOffs: ReturnType<typeof createHandOffRequests>;
}
