import createFrontTargets from './create-front-targets';

describe('createFrontTargets', () => {
  const change = { key: 'https a', target: 'http://203.0.113.7/', setAt: 2 };

  it('tells the primary what was registered, and resolves once the primary told it back', async () => {
    const send = jest.fn();
    const targets = createFrontTargets(send);
    const done = jest.fn();
    const published = targets.publish(change).then(done);

    expect(send).toHaveBeenCalledWith({ nodeWebserver: 'target', change });
    expect(targets.get('https a')).toBe(change);
    targets.receive([
      { ...change, key: 'https b' },
      { ...change, setAt: 1 },
    ]);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();

    targets.receive([change]);
    await published;
  });

  it('resolves with a newer change, which counts then', async () => {
    const targets = createFrontTargets(jest.fn());
    const published = targets.publish(change);

    targets.receive([{ ...change, setAt: 3 }]);

    await published;
    expect(targets.get('https a')?.setAt).toBe(3);
  });

  it('tells the ones that listen for a server what the primary says of it, until they stop', () => {
    const targets = createFrontTargets(jest.fn());
    const listener = jest.fn();
    const stop = targets.subscribe('https a', listener);

    targets.receive([change, { ...change, key: 'https b' }]);
    stop();
    targets.receive([{ ...change, setAt: 3 }]);

    expect(listener.mock.calls).toEqual([[change]]);
  });

  it('does not take what is older than what it knows', () => {
    const targets = createFrontTargets(jest.fn());
    const listener = jest.fn();
    targets.subscribe('https a', listener);
    targets.receive([change]);

    targets.receive([{ ...change, setAt: 1 }]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(targets.get('https a')).toBe(change);
  });
});
