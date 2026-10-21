import forEachWhile from './for-each-while';

describe('forEachWhile', () => {
  let cleanedUp: boolean;

  async function* source() {
    try {
      yield 1;
      yield 2;
      yield 3;
    } finally {
      cleanedUp = true;
    }
  }

  beforeEach(() => {
    cleanedUp = false;
  });

  it('visits every item in order and tells that it did', async () => {
    const seen: number[] = [];

    const visited = await forEachWhile(source(), async (item) => {
      seen.push(item);
      return true;
    });

    expect(visited).toBe(true);
    expect(seen).toEqual([1, 2, 3]);
    expect(cleanedUp).toBe(true);
  });

  it('stops at the item that is answered with false and lets the source clean up', async () => {
    const seen: number[] = [];

    const visited = await forEachWhile(source(), async (item) => {
      seen.push(item);
      return item < 2;
    });

    expect(visited).toBe(false);
    expect(seen).toEqual([1, 2]);
    expect(cleanedUp).toBe(true);
  });

  it('lets the error of the visit through after the source cleaned up', async () => {
    await expect(
      forEachWhile(source(), async () => {
        throw new Error('visit failed');
      })
    ).rejects.toThrow('visit failed');
    expect(cleanedUp).toBe(true);
  });
});
