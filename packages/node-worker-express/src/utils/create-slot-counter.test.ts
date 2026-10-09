import createSlotCounter from './create-slot-counter';

describe('createSlotCounter', () => {
  it('gives out slots up to the limit for each key', () => {
    const { take } = createSlotCounter(2);

    expect(take('a')).toBeDefined();
    expect(take('a')).toBeDefined();
    expect(take('a')).toBeUndefined();
    expect(take('b')).toBeDefined();
  });

  it('gives a slot out again once it was released', () => {
    const { take } = createSlotCounter(1);

    take('a')?.();

    expect(take('a')).toBeDefined();
  });

  it('frees a slot once, however often it is released', () => {
    const { take } = createSlotCounter(2);
    const first = take('a');
    take('a');

    first?.();
    first?.();

    expect(take('a')).toBeDefined();
    expect(take('a')).toBeUndefined();
  });

  it('has no limit with 0', () => {
    const { take } = createSlotCounter(0);

    expect(Array.from({ length: 5000 }, () => take('a')).every(Boolean)).toBe(true);
  });
});
