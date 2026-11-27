import createPortPool from './create-port-pool';

describe('createPortPool', () => {
  const lookup = { from: 4000, to: 4002, address: 'localhost' };

  it('gives every port of a lookup to one at a time, and looks once', async () => {
    const find = jest.fn(async () => [4000, 4001]);
    const pool = createPortPool(find);

    const taken = await Promise.all([pool.take(lookup), pool.take(lookup)]);
    await expect(pool.take(lookup)).rejects.toThrow('No more available port left');
    pool.give(taken[0]);

    expect(taken).toEqual([4000, 4001]);
    expect(await pool.take(lookup)).toBe(4000);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(lookup);
  });

  it('does not give a port to two that two lookups found', async () => {
    const pool = createPortPool(async () => [4000, 4001]);

    expect([await pool.take(), await pool.take(lookup)]).toEqual([4000, 4001]);
  });

  it('looks again after a lookup that failed', async () => {
    const find = jest.fn(async () => [4000]);
    find.mockRejectedValueOnce(new Error('no ports'));
    const pool = createPortPool(find);

    await expect(pool.take(lookup)).rejects.toThrow('no ports');

    expect(await pool.take(lookup)).toBe(4000);
  });
});
