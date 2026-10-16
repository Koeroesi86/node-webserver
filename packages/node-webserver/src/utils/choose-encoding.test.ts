import chooseEncoding from './choose-encoding';

describe('chooseEncoding', () => {
  it.each([
    ['gzip, deflate, br', ['br', 'gzip', 'deflate'], 'br'],
    ['gzip, deflate, br', ['gzip', 'br'], 'gzip'],
    ['gzip;q=0.5, br;q=0.9', ['br', 'gzip'], 'br'],
    ['gzip;q=0.9, br;q=0.5', ['br', 'gzip'], 'gzip'],
    ['gzip;q=0, deflate', ['gzip', 'deflate'], 'deflate'],
    ['*', ['br', 'gzip'], 'br'],
    ['*;q=0.1, gzip', ['br', 'gzip'], 'gzip'],
    ['GZIP', ['gzip'], 'gzip'],
    ['identity', ['gzip'], undefined],
    ['', ['gzip'], undefined],
    ['compress', ['gzip'], undefined],
    ['gzip;q=nonsense', ['gzip'], undefined],
  ] as const)('for %j with %j chooses %s', (accept, supported, expected) => {
    expect(chooseEncoding(accept, [...supported])).toBe(expected);
  });
});
