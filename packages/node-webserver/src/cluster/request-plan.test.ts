import requestPlan from './request-plan';
import { createFakeFork } from './fake-front.test-helper';

describe('requestPlan', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const plan = { frontCount: 2 } as never;
  const start = () => {
    const { fork, fronts } = createFakeFork();
    return { result: requestPlan(fork, 1000), fronts };
  };

  it('resolves with what the process answers, which is told to only do that', async () => {
    const { result, fronts } = start();

    fronts[0].say({ nodeWebserver: 'hello' });
    fronts[0].say({ nodeWebserver: 'plan', plan });
    fronts[0].exit(0);

    await expect(result).resolves.toBe(plan);
    expect(fronts[0].front).toEqual({ index: 0, count: 1, plan: true });
    jest.runAllTimers();
    expect(fronts[0].killed).toBe(false);
  });

  it('rejects when the process ends without an answer, as for a configuration that cannot be loaded', async () => {
    const { result, fronts } = start();

    fronts[0].exit(1);

    await expect(result).rejects.toThrow('ended with code 1');
  });

  it('kills a process that does not answer in time', async () => {
    const { result, fronts } = start();
    const rejected = expect(result).rejects.toThrow('did not answer within 1000 ms');

    jest.advanceTimersByTime(1000);

    await rejected;
    expect(fronts[0].killed).toBe(true);
  });
});
