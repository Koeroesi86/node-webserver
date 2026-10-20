import watchWorkerUptime from './watch-worker-uptime';

describe('watchWorkerUptime', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is not stable before the minimum uptime', () => {
    const onStable = jest.fn();
    const uptime = watchWorkerUptime(1000, onStable);

    jest.advanceTimersByTime(999);

    expect([uptime.isStable(), onStable.mock.calls.length]).toEqual([false, 0]);
  });

  it('turns stable and tells once the minimum uptime passed', () => {
    const onStable = jest.fn();
    const uptime = watchWorkerUptime(1000, onStable);

    jest.advanceTimersByTime(1000);

    expect([uptime.isStable(), onStable.mock.calls.length]).toEqual([true, 1]);
  });

  it('never turns stable once stopped', () => {
    const onStable = jest.fn();
    const uptime = watchWorkerUptime(1000, onStable);

    uptime.stop();
    jest.advanceTimersByTime(5000);

    expect([uptime.isStable(), onStable.mock.calls.length]).toEqual([false, 0]);
  });
});
