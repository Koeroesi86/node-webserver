import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const service = { add: jest.fn(), remove: jest.fn(), run: jest.fn(), stop: jest.fn() };
const start = jest.fn();

jest.mock('os-service', () => ({ __esModule: true, default: service }));
jest.mock('../utils/start', () => ({ __esModule: true, default: (...args: unknown[]) => start(...args) }));

describe('manageService', () => {
  const originalArgv = process.argv;
  const originalConfig = process.env.NODE_WEBSERVER_CONFIG;
  let folder: string;
  let configPath: string;

  beforeEach(() => {
    jest.resetModules();
    Object.values(service).forEach((mock) => mock.mockReset());
    start.mockReset();
    folder = mkdtempSync(join(tmpdir(), 'manage-service-'));
    configPath = join(folder, 'configuration.js');
    writeFileSync(configPath, "module.exports = { serviceName: 'nws', serviceDisplayName: 'Node webserver' };");
    delete process.env.NODE_WEBSERVER_CONFIG;
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (originalConfig !== undefined) process.env.NODE_WEBSERVER_CONFIG = originalConfig;
    rmSync(folder, { recursive: true, force: true });
  });

  const run = (...args: string[]) => {
    process.argv = ['node', 'manageService.js', ...args];
    require('./manageService');
  };

  it('fails when the configuration does not exist', () => {
    expect(() => run('--add', '--configuration', join(folder, 'missing.js'))).toThrow('Configuration file does not exist');
  });

  it('installs the service under the name and display name of the configuration', () => {
    run('--add', '--configuration', configPath);

    expect(service.add).toHaveBeenCalledWith(
      'nws',
      { displayName: 'Node webserver', programPath: expect.stringContaining('manageService'), programArgs: ['--run', '--configuration', configPath] },
      expect.any(Function)
    );
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('names the service in the display when the configuration has no display name', () => {
    writeFileSync(configPath, "module.exports = { serviceName: 'nws' };");
    run('--add', '--configuration', configPath);

    expect(service.add.mock.calls[0][1].displayName).toBe('nws');
  });

  it('removes the service', () => {
    run('--remove', '--configuration', configPath);

    expect(service.remove).toHaveBeenCalledWith('nws', expect.any(Function));
    expect(service.add).not.toHaveBeenCalled();
  });

  it('starts the server and stops the service when asked to run', () => {
    run('--run', '--configuration', configPath);

    expect(start).toHaveBeenCalledWith(configPath);
    expect(service.run).toHaveBeenCalledTimes(1);

    service.run.mock.calls[0][0]();

    expect(service.stop).toHaveBeenCalledWith(0);
  });

  it('takes the configuration from the environment', () => {
    process.env.NODE_WEBSERVER_CONFIG = configPath;
    run('--remove');

    expect(service.remove).toHaveBeenCalledWith('nws', expect.any(Function));
  });

  it('traces the error of the operating system, and stays quiet without one', () => {
    const trace = jest.spyOn(console, 'trace').mockImplementation(() => {});
    run('--remove', '--configuration', configPath);
    const handleError = service.remove.mock.calls[0][1];
    handleError();
    handleError(new Error('denied'));

    expect(trace).toHaveBeenCalledTimes(1);
    trace.mockRestore();
  });

  it('prints the usage without an argument', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    run('--configuration', configPath);

    expect(info).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('--add'));
    expect(service.add).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
