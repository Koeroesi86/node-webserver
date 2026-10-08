import { formatChange } from './format-change';

describe('formatChange', () => {
  it('is the change in percent with its sign', () => {
    expect(formatChange(100, 150)).toBe('+50.0%');
    expect(formatChange(100, 75)).toBe('−25.0%');
    expect(formatChange(100, 100)).toBe('+0.0%');
  });

  it('is n/a when one side is not known, or the base is 0', () => {
    expect(formatChange(undefined, 1)).toBe('n/a');
    expect(formatChange(1, undefined)).toBe('n/a');
    expect(formatChange(0, 1)).toBe('n/a');
  });
});
