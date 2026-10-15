import { WORKER_EVENT } from '../constants';
import createMetricsWaiting from './create-metrics-waiting';
import createRequestContexts from './create-request-contexts';
import type { ServerMetrics } from './metrics';

const metricsOf = (uptimeSeconds: number) => ({ uptimeSeconds }) as ServerMetrics;

describe('createMetricsWaiting', () => {
  const setup = () => {
    const send = jest.fn(() => true);
    const contexts = createRequestContexts();

    return { send, contexts, waiting: createMetricsWaiting(contexts, { send }) };
  };

  it('asks the server and resolves the questions in the order they were asked', async () => {
    const { send, waiting, contexts } = setup();

    const first = waiting.request('r');
    const second = waiting.request('r');
    waiting.receive('r', metricsOf(1));
    waiting.receive('r', metricsOf(2));

    expect(send).toHaveBeenCalledWith({ type: WORKER_EVENT.METRICS_REQUEST, requestId: 'r' });
    expect(send).toHaveBeenCalledTimes(2);
    expect((await first).uptimeSeconds).toBe(1);
    expect((await second).uptimeSeconds).toBe(2);
    expect(contexts.size).toBe(0);
  });

  it('ignores metrics nobody asked for', () => {
    const { waiting, contexts } = setup();

    waiting.receive('r', metricsOf(1));

    expect(contexts.size).toBe(0);
  });

  it('drops the questions that are still open when the request is over', () => {
    const { waiting, contexts } = setup();
    waiting.request('r');

    waiting.clear('r');

    expect(contexts.size).toBe(0);
  });
});
