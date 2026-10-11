import { formatLineRanges } from './format-line-ranges';

describe('formatLineRanges', () => {
  it('joins consecutive lines into ranges', () => {
    expect(formatLineRanges([1, 2, 3, 7, 9, 10])).toBe('1-3, 7, 9-10');
  });

  it('is empty without lines', () => {
    expect(formatLineRanges([])).toBe('');
  });
});
