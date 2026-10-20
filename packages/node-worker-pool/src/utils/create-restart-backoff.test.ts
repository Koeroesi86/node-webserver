import createRestartBackoff from './create-restart-backoff';

describe('createRestartBackoff', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lets the first crash of a path restart at once', () => {
    const backoff = createRestartBackoff({ minUptime: 1000, base: 100, max: 1000 });

    backoff.recordFailure('a.js');

    expect(backoff.getBackoff('a.js')).toBe(0);
  });

  it('doubles the wait with every crash in a row up to the maximum', () => {
    const backoff = createRestartBackoff({ minUptime: 1000, base: 100, max: 300 });
    const waits = [1, 2, 3, 4].map(() => {
      backoff.recordFailure('a.js');
      return backoff.getBackoff('a.js');
    });

    expect(waits).toEqual([0, 100, 200, 300]);
  });

  it('lets the path start again once the wait is over', () => {
    const backoff = createRestartBackoff({ minUptime: 1000, base: 100, max: 1000 });
    backoff.recordFailure('a.js');
    backoff.recordFailure('a.js');

    jest.advanceTimersByTime(100);

    expect(backoff.getBackoff('a.js')).toBe(0);
  });

  it('keeps the crashes of one path apart from another', () => {
    const backoff = createRestartBackoff({ minUptime: 1000, base: 100, max: 1000 });
    backoff.recordFailure('a.js');
    backoff.recordFailure('a.js');

    expect(backoff.getBackoff('b.js')).toBe(0);
  });

  it('forgets the crashes of a path that was cleared', () => {
    const backoff = createRestartBackoff({ minUptime: 1000, base: 100, max: 1000 });
    backoff.recordFailure('a.js');
    backoff.recordFailure('a.js');

    backoff.clear('a.js');

    expect(backoff.getStats()).toEqual({});
  });

  it('reports the crashes and the time left per path', () => {
    const backoff = createRestartBackoff({ minUptime: 1000, base: 100, max: 1000 });
    backoff.recordFailure('a.js');
    backoff.recordFailure('a.js');

    expect(backoff.getStats()).toEqual({ 'a.js': { crashes: 2, retryInMs: 100 } });
  });
});
