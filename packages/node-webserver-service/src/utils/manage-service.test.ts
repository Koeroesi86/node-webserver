import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import manageService from './manage-service';

const installService = jest.fn();
const removeService = jest.fn();
const start = jest.fn();

jest.mock('./install-service', () => ({ __esModule: true, default: (...args: unknown[]) => installService(...args) }));
jest.mock('./remove-service', () => ({ __esModule: true, default: (...args: unknown[]) => removeService(...args) }));
jest.mock('./start', () => ({ __esModule: true, default: (...args: unknown[]) => start(...args) }));

describe('manageService', () => {
  let folder: string;
  let configPath: string;

  const writeConfiguration = (configuration: object) => writeFileSync(configPath, `module.exports = ${JSON.stringify(configuration)};`);

  beforeEach(() => {
    [installService, removeService, start].forEach((mock) => mock.mockReset().mockResolvedValue(undefined));
    folder = mkdtempSync(join(tmpdir(), 'manage-service-'));
    configPath = join(folder, 'configuration.js');
    writeConfiguration({ serviceName: 'nws', serviceDisplayName: 'Node webserver' });
  });

  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('installs the service described by the configuration, with absolute paths', async () => {
    await manageService(['--add', '--configuration', configPath], undefined);

    expect(installService).toHaveBeenCalledWith({
      name: 'nws',
      displayName: 'Node webserver',
      nodePath: process.execPath,
      scriptPath: expect.stringMatching(/dist[\\/]scripts[\\/]manageService\.js$/),
      configPath,
      workingDirectory: folder,
      user: undefined,
      userService: false,
      logFolder: undefined,
    });
  });

  it('passes the user and the log folder, and names the service when it has no display name', async () => {
    writeConfiguration({ serviceName: 'nws', serviceUser: 'www', fileLogPath: '/var/log/nws' });
    await manageService(['--add'], configPath);

    expect(installService).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'nws', user: 'www', logFolder: '/var/log/nws' }));
  });

  it('installs and removes the service for the current user', async () => {
    await manageService(['--add', '--user'], configPath);
    await manageService(['--remove', '--user'], configPath);

    expect(installService).toHaveBeenCalledWith(expect.objectContaining({ userService: true }));
    expect(removeService).toHaveBeenCalledWith(expect.objectContaining({ userService: true }));
  });

  it('does not combine --user with serviceUser, or use it without an action', async () => {
    writeConfiguration({ serviceName: 'nws', serviceUser: 'www' });
    await expect(manageService(['--add', '--user'], configPath)).rejects.toThrow('serviceUser');
    await expect(manageService(['--run', '--user'], configPath)).rejects.toThrow('--add or --remove');
    expect(installService).not.toHaveBeenCalled();
  });

  it('removes the service', async () => {
    await manageService(['--remove', '--configuration', configPath], undefined);

    expect(removeService).toHaveBeenCalledWith(expect.objectContaining({ name: 'nws' }));
    expect(installService).not.toHaveBeenCalled();
  });

  it('starts the server in this process, and passes a failed start on', async () => {
    await manageService(['--run', '--configuration', configPath], undefined);
    expect(start).toHaveBeenCalledWith(configPath);

    start.mockRejectedValue(new Error('port in use'));
    await expect(manageService(['--run'], configPath)).rejects.toThrow('port in use');
  });

  it('fails without a configuration, with a missing one and with an invalid name', async () => {
    await expect(manageService(['--add'], undefined)).rejects.toThrow('--configuration');
    await expect(manageService(['--add', '--configuration', join(folder, 'missing.js')], undefined)).rejects.toThrow('does not exist');

    writeConfiguration({ serviceName: '../evil' });
    await expect(manageService(['--add'], configPath)).rejects.toThrow('Invalid serviceName');
    expect(installService).not.toHaveBeenCalled();
  });

  it('prints the usage without an action', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    await manageService(['--configuration', configPath], undefined);

    expect(info).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('--add'));
    info.mockRestore();
  });
});
