import { resolve } from 'path';

const runCli = jest.fn();

jest.mock('../cli', () => ({ runCli: (...args: unknown[]) => runCli(...args) }));

const configuration = resolve(__dirname, '../../configuration.example.js');

describe('cli', () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    runCli.mockReset();
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    jest.restoreAllMocks();
  });

  const runScript = async (...args: string[]) => {
    process.argv = ['node', 'cli.js', ...args];
    jest.isolateModules(() => {
      require('./cli');
    });
    await new Promise(process.nextTick);
  };

  it('passes the arguments and the configuration of the environment on, and leaves the exit code alone on success', async () => {
    runCli.mockResolvedValue(undefined);
    process.env.NODE_WEBSERVER_CONFIG = configuration;

    await runScript('--config', configuration);

    expect(runCli).toHaveBeenCalledWith(['node', 'cli.js', '--config', configuration], configuration);
    expect(process.exitCode).toBeUndefined();
    delete process.env.NODE_WEBSERVER_CONFIG;
  });

  it('prints the message and exits non-zero when the command fails', async () => {
    runCli.mockRejectedValue(new Error('port in use'));

    await runScript();

    expect(console.error).toHaveBeenCalledWith('port in use');
    expect(process.exitCode).toBe(1);
  });
});
