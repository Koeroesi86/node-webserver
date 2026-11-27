import createFrontMetrics from './create-front-metrics';
import { METRICS_ANSWER_TIMEOUT } from '../constants';
import type { ServerMetrics } from '@koeroesi86/node-worker-express';

describe('createFrontMetrics', () => {
  const metrics = (uptimeSeconds: number, front?: number) => ({ uptimeSeconds, ...(front && { front }) }) as ServerMetrics;

  afterEach(() => jest.useRealTimers());

  it('answers the primary with its metrics, under its number', () => {
    const send = jest.fn();

    createFrontMetrics(1, send, () => metrics(5)).receive({ nodeWebserver: 'metrics-read', query: 3 });

    expect(send).toHaveBeenCalledWith({ nodeWebserver: 'metrics-read-done', query: 3, metrics: metrics(5, 2) });
  });

  it('collects the metrics of all fronts, with its own on top', async () => {
    const send = jest.fn();
    const front = createFrontMetrics(1, send, () => metrics(0));
    const collected = front.collect();

    front.receive({ nodeWebserver: 'metrics', id: 99, answers: [] });
    front.receive({ nodeWebserver: 'metrics', id: 1, answers: [metrics(10, 1), metrics(20, 2)] });

    expect(send).toHaveBeenCalledWith({ nodeWebserver: 'metrics-wanted', id: 1 });
    expect(await collected).toEqual({ uptimeSeconds: 20, front: 2, fronts: { 1: { uptimeSeconds: 10 }, 2: { uptimeSeconds: 20 } } });
  });

  it('has its own numbers when the primary says nothing', async () => {
    jest.useFakeTimers();
    const collected = createFrontMetrics(0, jest.fn(), () => metrics(7)).collect();

    jest.advanceTimersByTime(METRICS_ANSWER_TIMEOUT);

    expect(await collected).toEqual({ uptimeSeconds: 7, front: 1, fronts: {} });
  });

  it('knows the processes of the fronts, as the primary said last', () => {
    const front = createFrontMetrics(0, jest.fn());

    front.receive({ nodeWebserver: 'processes', processes: { 1: 11 } });

    expect(front.getProcesses()).toEqual({ 1: 11 });
  });
});
