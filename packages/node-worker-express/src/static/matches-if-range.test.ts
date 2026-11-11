import matchesIfRange from './matches-if-range';

const modified = Date.UTC(2026, 0, 2, 3, 4, 5, 678);

describe('matchesIfRange', () => {
  it('matches without the header', () => {
    expect(matchesIfRange(undefined, 'W/"a"', modified)).toBe(true);
  });

  it.each(['W/"a"', '"a"'])('matches the validator %s', (header) => {
    expect(matchesIfRange(header, 'W/"a"', modified)).toBe(true);
  });

  it('does not match another validator', () => {
    expect(matchesIfRange('"b"', 'W/"a"', modified)).toBe(false);
  });

  it('matches the modification date, to the second', () => {
    expect(matchesIfRange(new Date(modified).toUTCString(), 'W/"a"', modified)).toBe(true);
    expect(matchesIfRange(new Date(modified - 5000).toUTCString(), 'W/"a"', modified)).toBe(false);
  });

  it('does not match what is neither', () => {
    expect(matchesIfRange('yesterday-ish', 'W/"a"', modified)).toBe(false);
  });
});
