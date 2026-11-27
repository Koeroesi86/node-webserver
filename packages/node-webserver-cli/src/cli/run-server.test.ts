import { resolve } from 'path';
import runServer from './run-server';

const startCluster = jest.fn();
const checkConfiguration = jest.fn();
const startLauncher = jest.fn();

jest.mock('@koeroesi86/node-webserver', () => ({
  __esModule: true,
  startCluster: (...args: unknown[]) => startCluster(...args),
  startLauncher: () => startLauncher(),
  checkConfiguration: (...args: unknown[]) => checkConfiguration(...args),
  formatProblems: (problems: { message: string }[]) => problems.map(({ message }) => message).join('\n'),
}));

const configPath = resolve(__dirname, '../../configuration.example.js');

describe('runServer', () => {
  beforeEach(() => {
    startCluster.mockReset();
    checkConfiguration.mockReset();
    startLauncher.mockReset();
  });

  afterEach(() => {
    process.exitCode = undefined;
    jest.restoreAllMocks();
  });

  it('starts the server with the configuration of the path, which it has watched', async () => {
    await runServer(configPath, false);

    expect(startCluster).toHaveBeenCalledTimes(1);
    expect(startCluster).toHaveBeenCalledWith(require(configPath), undefined, { configurationFile: configPath });
    expect(checkConfiguration).not.toHaveBeenCalled();
  });

  it('starts nothing in the process that became the launcher, which does not load the configuration', async () => {
    startLauncher.mockReturnValue(true);

    await runServer(resolve(__dirname, 'missing.js'), false);

    expect(startCluster).not.toHaveBeenCalled();
  });

  it('rejects when the server does not start, so the caller can exit with an error', async () => {
    startCluster.mockRejectedValue(new Error('port in use'));

    await expect(runServer(configPath, false)).rejects.toThrow('port in use');
  });

  it('checks the configuration without starting the server, and exits with 0 when it is valid', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    checkConfiguration.mockReturnValue([]);

    await runServer(configPath, true);

    expect(checkConfiguration).toHaveBeenCalledWith(require(configPath));
    expect(startCluster).not.toHaveBeenCalled();
    expect(startLauncher).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(`${configPath} is valid.`);
    expect(process.exitCode).toBe(0);
  });

  it('prints the problems and exits with 1 when one is an error', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    checkConfiguration.mockReturnValue([
      { severity: 'warning', message: 'odd' },
      { severity: 'error', message: 'wrong' },
    ]);

    await runServer(configPath, true);

    expect(error).toHaveBeenCalledWith('odd\nwrong');
    expect(process.exitCode).toBe(1);
  });

  it('prints warnings and still exits with 0', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    checkConfiguration.mockReturnValue([{ severity: 'warning', message: 'odd' }]);

    await runServer(configPath, true);

    expect(error).toHaveBeenCalledWith('odd');
    expect(process.exitCode).toBe(0);
  });
});
