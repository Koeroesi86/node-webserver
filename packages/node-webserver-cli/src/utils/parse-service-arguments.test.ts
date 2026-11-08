import parseServiceArguments from './parse-service-arguments';

describe('parseServiceArguments', () => {
  it('reads the action, the configuration and --user', () => {
    expect(parseServiceArguments(['add', '--config', 'c.js', '--user'])).toEqual({ action: 'add', user: true, config: 'c.js' });
  });

  it('leaves everything optional', () => {
    expect(parseServiceArguments([])).toEqual({ action: undefined, user: false, config: undefined });
  });

  it('reads the options before the action', () => {
    expect(parseServiceArguments(['--config=c.js', 'remove'])).toMatchObject({ action: 'remove', config: 'c.js' });
  });

  it('rejects an option it does not know, like the old --configuration', () => {
    expect(() => parseServiceArguments(['add', '--configuration', 'c.js'])).toThrow();
  });
});
