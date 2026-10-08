import { median } from './median';

describe('median', () => {
  it('is the middle value, or the mean of the two in the middle', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('is not known for nothing, and leaves out what is not known', () => {
    expect(median([])).toBeUndefined();
    expect(median([undefined, 5, undefined])).toBe(5);
  });
});
