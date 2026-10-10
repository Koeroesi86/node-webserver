import getHostPattern from './get-host-pattern';

describe('getHostPattern', () => {
  it('matches one label for a wildcard', () => {
    const pattern = getHostPattern('*.localhost');

    expect(pattern.test('web.localhost')).toBe(true);
    expect(pattern.test('WEB.localhost')).toBe(true);
    expect(pattern.test('a.web.localhost')).toBe(false);
    expect(pattern.test('localhost')).toBe(false);
  });

  it('takes the other characters literally', () => {
    const pattern = getHostPattern('a+b.*.localhost');

    expect(pattern.test('a+b.web.localhost')).toBe(true);
    expect(pattern.test('aab.web.localhost')).toBe(false);
    expect(pattern.test('a+bxweb.localhost')).toBe(false);
  });
});
