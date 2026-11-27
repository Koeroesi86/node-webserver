import createMetricsExchange from './create-metrics-exchange';
import { METRICS_TIMEOUT } from '../constants';
import type { ServerMetrics } from '@koeroesi86/node-worker-express';

describe('createMetricsExchange', () => {
  const metrics = (front: number) => ({ front }) as unknown as ServerMetrics;

  afterEach(() => jest.useRealTimers());

  /** two fronts that listen */
  const joinTwo = () => {
    const exchange = createMetricsExchange();
    const sends = [jest.fn(), jest.fn()];
    const members = sends.map((send) => exchange.join(send));
    members.forEach((member) => member.hello());
    return { sends, members, exchange };
  };

  it('asks every front for its metrics when one wants them, and gives it all the answers', () => {
    const { sends, members } = joinTwo();

    members[1].receive({ nodeWebserver: 'metrics-wanted', id: 7 });
    expect(sends.map((send) => send.mock.calls)).toEqual(Array(2).fill([[{ nodeWebserver: 'metrics-read', query: 1 }]]));
    members[0].receive({ nodeWebserver: 'metrics-read-done', query: 1, metrics: metrics(1) });
    expect(sends[1]).toHaveBeenCalledTimes(1);
    members[1].receive({ nodeWebserver: 'metrics-read-done', query: 1, metrics: metrics(2) });

    expect(sends[1]).toHaveBeenLastCalledWith({ nodeWebserver: 'metrics', id: 7, answers: [metrics(1), metrics(2)] });
    expect(sends[0]).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['leaves', (members: ReturnType<typeof joinTwo>['members']) => members[0].leave()],
    ['says nothing', () => jest.advanceTimersByTime(METRICS_TIMEOUT)],
  ])('answers without a front that %s', (_, happen) => {
    jest.useFakeTimers();
    const { sends, members } = joinTwo();
    members[1].receive({ nodeWebserver: 'metrics-wanted', id: 7 });
    members[1].receive({ nodeWebserver: 'metrics-read-done', query: 1, metrics: metrics(2) });

    happen(members);
    members[1].receive({ nodeWebserver: 'metrics-read-done', query: 1, metrics: metrics(2) });

    expect(sends[1]).toHaveBeenLastCalledWith({ nodeWebserver: 'metrics', id: 7, answers: [metrics(2)] });
    expect(sends[1]).toHaveBeenCalledTimes(2);
  });

  it('tells the fronts the processes of all of them, as they come and go', () => {
    const { sends, members, exchange } = joinTwo();

    members[0].receive({ nodeWebserver: 'process', front: 1, pid: 11 });
    members[1].receive({ nodeWebserver: 'process', front: 2, pid: 12 });
    expect(sends[0]).toHaveBeenLastCalledWith({ nodeWebserver: 'processes', processes: { 1: 11, 2: 12 } });

    members[1].leave();
    expect(sends[0]).toHaveBeenLastCalledWith({ nodeWebserver: 'processes', processes: { 1: 11 } });
    const silent = jest.fn();
    exchange.join(silent).leave();
    expect(sends[0]).toHaveBeenCalledTimes(3);
    expect(silent).not.toHaveBeenCalled();
  });
});
