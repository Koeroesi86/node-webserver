import translateArguments from './translate-arguments';

describe('translateArguments', () => {
  it('turns --add and --remove into the service commands of nws-cli', () => {
    expect(translateArguments(['--add', '--configuration', 'c.js'])).toEqual(['service', 'add', '--config', 'c.js']);
    expect(translateArguments(['--remove', '--configuration', 'c.js'])).toEqual(['service', 'remove', '--config', 'c.js']);
  });

  it('keeps --user with the action', () => {
    expect(translateArguments(['--add', '--user'])).toEqual(['service', 'add', '--user']);
    expect(translateArguments(['--remove', '--user', '--configuration=c.js'])).toEqual(['service', 'remove', '--user', '--config', 'c.js']);
  });

  it('turns --run into the server of nws-cli, which an installed unit of the old package starts', () => {
    expect(translateArguments(['--run', '--configuration', '/etc/nws/configuration.js'])).toEqual(['--config', '/etc/nws/configuration.js']);
    expect(translateArguments(['--run'])).toEqual([]);
  });

  it('lets --run win and --add win over --remove, as they did', () => {
    expect(translateArguments(['--run', '--add', '--configuration', 'c.js'])).toEqual(['--config', 'c.js']);
    expect(translateArguments(['--add', '--remove'])).toEqual(['service', 'add']);
  });

  it('asks for the usage without an action', () => {
    expect(translateArguments([])).toEqual(['service']);
    expect(translateArguments(['--configuration', 'c.js'])).toEqual(['service', '--config', 'c.js']);
  });

  it('does not take --user without --add or --remove', () => {
    expect(() => translateArguments(['--user'])).toThrow('--add or --remove');
    expect(() => translateArguments(['--run', '--user'])).toThrow('--add or --remove');
  });
});
