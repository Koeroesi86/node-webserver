import getRestartDelay from './get-restart-delay';

describe('getRestartDelay', () => {
  it('replaces at once the first time, then waits twice as long every time, up to the maximum', () => {
    expect([0, 1, 2, 3, 4, 30].map(getRestartDelay)).toEqual([0, 0, 100, 200, 400, 10000]);
  });
});
