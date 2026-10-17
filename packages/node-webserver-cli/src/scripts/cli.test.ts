import { resolve } from 'path';

const startServer = jest.fn();
const checkConfiguration = jest.fn();

jest.mock('@koeroesi86/node-webserver', () => ({
  __esModule: true,
  default: (...args: unknown[]) => startServer(...args),
  checkConfiguration: (...args: unknown[]) => checkConfiguration(...args),
  formatProblems: (problems: { message: string }[]) => problems.map(({ message }) => message).join('\n'),
}));

const configuration = resolve(__dirname, '../../configuration.example.js');

describe('cli', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    startServer.mockReset();
    checkConfiguration.mockReset();
    jest.resetModules();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = undefined;
    jest.restoreAllMocks();
  });

  it('requires a configuration', () => {
    process.argv = ['node', 'cli.js'];

    expect(() => require('./cli')).toThrow('use with --config </path/to/config>');
    expect(startServer).not.toHaveBeenCalled();
  });

  it('starts the server with the configuration it was pointed to', async () => {
    process.argv = ['node', 'cli.js', '--config', configuration];
    require('./cli');
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));

    expect(startServer).toHaveBeenCalledTimes(1);
    expect(startServer.mock.calls[0][0]).toEqual(require(configuration));
  });

  const check = async () => {
    process.argv = ['node', 'cli.js', '--config', configuration, '--check'];
    require('./cli');
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));
  };

  it('checks the configuration without starting the server, and exits with 0 when it is valid', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    checkConfiguration.mockReturnValue([]);

    await check();

    expect(checkConfiguration).toHaveBeenCalledWith(require(configuration));
    expect(startServer).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(`${configuration} is valid.`);
    expect(process.exitCode).toBe(0);
  });

  it('prints the problems and exits with 1 when one is an error', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    checkConfiguration.mockReturnValue([
      { severity: 'warning', message: 'odd' },
      { severity: 'error', message: 'wrong' },
    ]);

    await check();

    expect(error).toHaveBeenCalledWith('odd\nwrong');
    expect(process.exitCode).toBe(1);
  });

  it('prints warnings and still exits with 0', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    checkConfiguration.mockReturnValue([{ severity: 'warning', message: 'odd' }]);

    await check();

    expect(error).toHaveBeenCalledWith('odd');
    expect(process.exitCode).toBe(0);
  });
});
