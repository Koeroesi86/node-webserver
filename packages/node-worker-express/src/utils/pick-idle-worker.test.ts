import pickIdleWorker from './pick-idle-worker';

const idle = (spare: boolean, lastUsed: number) => ({ spare, lastUsed, stop: () => {} });

describe('pickIdleWorker', () => {
  it('picks the one used longest ago', () => {
    const oldest = idle(false, 1000);

    expect(pickIdleWorker([idle(false, 3000), oldest, idle(false, 2000)])).toBe(oldest);
  });

  it('picks a spare worker of a path before the last worker of one, even one used longer ago', () => {
    const spare = idle(true, 3000);

    expect(pickIdleWorker([idle(false, 1000), spare, idle(true, 4000)])).toBe(spare);
  });

  it('skips the pools that have no idle worker, and finds none when no pool has one', () => {
    const only = idle(false, 1000);

    expect(pickIdleWorker([undefined, only, undefined])).toBe(only);
    expect(pickIdleWorker([undefined, undefined])).toBeUndefined();
  });
});
