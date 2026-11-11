import runInSlot from './run-in-slot';

describe('runInSlot', () => {
  it('serves what was acquired with the way to give the slot back', async () => {
    const release = jest.fn();
    const serve = jest.fn();

    await expect(
      runInSlot(
        () => release,
        async () => 'lease',
        serve
      )
    ).resolves.toBe(true);

    expect(serve).toHaveBeenCalledWith('lease', release);
    expect(release).not.toHaveBeenCalled();
  });

  it('gets and serves nothing when no slot is left', async () => {
    const acquire = jest.fn();
    const serve = jest.fn();

    await expect(runInSlot(() => undefined, acquire, serve)).resolves.toBe(false);

    expect(acquire).not.toHaveBeenCalled();
    expect(serve).not.toHaveBeenCalled();
  });

  it('takes the slot before it acquires', async () => {
    const order: string[] = [];

    await runInSlot(
      () => (order.push('take'), () => undefined),
      async () => order.push('acquire'),
      () => undefined
    );

    expect(order).toEqual(['take', 'acquire']);
  });

  it('gives the slot back and passes on the error when acquiring fails', async () => {
    const release = jest.fn();
    const serve = jest.fn();

    await expect(
      runInSlot(
        () => release,
        async () => {
          throw new Error('no worker');
        },
        serve
      )
    ).rejects.toThrow('no worker');

    expect(release).toHaveBeenCalledTimes(1);
    expect(serve).not.toHaveBeenCalled();
  });

  it('gives the slot back and passes on the error when serving throws', async () => {
    const release = jest.fn();

    await expect(
      runInSlot(
        () => release,
        async () => 'lease',
        () => {
          throw new Error('broken');
        }
      )
    ).rejects.toThrow('broken');

    expect(release).toHaveBeenCalledTimes(1);
  });
});
