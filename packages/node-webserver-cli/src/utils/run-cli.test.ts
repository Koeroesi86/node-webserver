import { resolve } from 'path';
import runCli from './run-cli';

const manageService = jest.fn();
const runServer = jest.fn();

jest.mock('./manage-service', () => ({ __esModule: true, default: (...args: unknown[]) => manageService(...args) }));
jest.mock('./run-server', () => ({ __esModule: true, default: (...args: unknown[]) => runServer(...args) }));

const configPath = resolve(__dirname, '../../configuration.example.js');

describe('runCli', () => {
  beforeEach(() => {
    [manageService, runServer].forEach((mock) => mock.mockReset().mockResolvedValue(undefined));
  });

  it('runs the server of --config', async () => {
    await runCli(['node', 'cli.js', '--config', configPath], undefined);

    expect(runServer).toHaveBeenCalledWith(configPath, false);
    expect(manageService).not.toHaveBeenCalled();
  });

  it('only checks with --check', async () => {
    await runCli(['node', 'cli.js', '--config', configPath, '--check'], undefined);

    expect(runServer).toHaveBeenCalledWith(configPath, true);
  });

  it('falls back to the environment, also for a --config without a value', async () => {
    await runCli(['node', 'cli.js'], configPath);
    await runCli(['node', 'cli.js', '--config'], configPath);

    expect(runServer).toHaveBeenCalledTimes(2);
    expect(runServer).toHaveBeenNthCalledWith(2, configPath, false);
  });

  it('requires a configuration', async () => {
    await expect(runCli(['node', 'cli.js'], undefined)).rejects.toThrow('--config');
    expect(runServer).not.toHaveBeenCalled();
  });

  it('hands what follows service to the service commands, with the environment', async () => {
    await runCli(['node', 'cli.js', 'service', 'add', '--config', configPath, '--user'], 'env.js');

    expect(manageService).toHaveBeenCalledWith(['add', '--config', configPath, '--user'], 'env.js');
    expect(runServer).not.toHaveBeenCalled();
  });
});
