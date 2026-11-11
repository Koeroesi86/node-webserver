import untilIdle from './until-idle';

describe('untilIdle', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves once it is idle', async () => {
    let becomeIdle = () => {};
    const resolved = jest.fn();

    const waiting = untilIdle(() => new Promise((resolve) => (becomeIdle = resolve)), 60000).then(resolved);
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    becomeIdle();
    await waiting;

    expect(resolved).toHaveBeenCalled();
  });

  it('resolves after the timeout when it does not become idle', async () => {
    jest.useFakeTimers();

    const waiting = untilIdle(() => new Promise(() => {}), 1000);
    jest.advanceTimersByTime(1000);

    await expect(waiting).resolves.toBeUndefined();
  });
});
