import parseArguments from './parse-arguments';

describe('parseArguments', () => {
  it('reads the flags and the configuration, in any order', () => {
    expect(parseArguments(['--configuration', '/etc/nws.js', '--add'])).toEqual({ add: true, remove: false, run: false, configuration: '/etc/nws.js' });
    expect(parseArguments(['--run', '--configuration=/a b/c.js'])).toMatchObject({ run: true, configuration: '/a b/c.js' });
  });

  it('is all off without arguments', () => {
    expect(parseArguments([])).toEqual({ add: false, remove: false, run: false, configuration: undefined });
  });

  it('rejects an unknown option', () => {
    expect(() => parseArguments(['--unknown'])).toThrow();
  });
});
