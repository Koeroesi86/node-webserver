import { WorkerEnvironment } from './worker-environment';
import createHandOffRequests from './create-hand-off-requests';
import createMetricsWaiting from './create-metrics-waiting';
import createRequestContexts from './create-request-contexts';

/** the environment of the units of a worker process, with a channel that records what is sent through it */
export const createTestEnvironment = (overrides: Partial<WorkerEnvironment> = {}) => {
  const send = jest.fn(() => true);
  const channel = { send };
  const contexts = createRequestContexts();
  const env: WorkerEnvironment = {
    worker: jest.fn(),
    channel,
    isWritable: () => true,
    contexts,
    metrics: createMetricsWaiting(contexts, channel),
    handOffs: createHandOffRequests(jest.fn()),
    ...overrides,
  };

  return { env, send, contexts };
};
