import parseRange from './parse-range';

describe('parseRange', () => {
  it.each([
    ['bytes=0-4', { start: 0, end: 4 }],
    ['bytes=5-', { start: 5, end: 99 }],
    ['bytes=-10', { start: 90, end: 99 }],
    ['bytes=-500', { start: 0, end: 99 }],
    ['bytes=90-500', { start: 90, end: 99 }],
    [' Bytes = 1 - 2 ', { start: 1, end: 2 }],
  ])('reads %s', (header, expected) => {
    expect(parseRange(header, 100)).toEqual(expected);
  });

  it.each(['bytes=100-', 'bytes=150-160', 'bytes=-0'])('finds %s outside of the file', (header) => {
    expect(parseRange(header, 100)).toBe('unsatisfiable');
  });

  it('finds every range of an empty file outside of it', () => {
    expect(parseRange('bytes=-5', 0)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
  });

  it.each([undefined, '', 'bytes=', 'bytes=-', 'bytes=0-1,5-6', 'items=0-1', 'bytes=9-2', 'bytes=a-b', 'bytes=-1-2'])('ignores %s', (header) => {
    expect(parseRange(header, 100)).toBeUndefined();
  });
});
