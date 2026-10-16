const start = jest.fn();
const copyFileSync = jest.fn();
const existsSync = jest.fn();

jest.mock('../utils/start', () => ({ __esModule: true, default: (...args: unknown[]) => start(...args) }));
jest.mock('fs', () => ({ copyFileSync: (...args: unknown[]) => copyFileSync(...args), existsSync: (...args: unknown[]) => existsSync(...args) }));

describe('start script', () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    jest.resetModules();
    [start, copyFileSync, existsSync].forEach((mock) => mock.mockReset());
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
    process.argv = ['node', 'start.js', '--configuration', '/tmp/nws-dev-configuration.js'];
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    jest.restoreAllMocks();
  });

  const runScript = async () => {
    jest.isolateModules(() => {
      require('./start');
    });
    await new Promise(process.nextTick);
  };

  it('copies the example configuration when the file does not exist yet, and starts with it', async () => {
    existsSync.mockReturnValue(false);
    start.mockResolvedValue(undefined);

    await runScript();

    expect(copyFileSync).toHaveBeenCalledWith(expect.stringMatching(/configuration\.example\.js$/), '/tmp/nws-dev-configuration.js');
    expect(start).toHaveBeenCalledWith('/tmp/nws-dev-configuration.js');
    expect(process.exitCode).toBeUndefined();
  });

  it('does not overwrite an existing configuration', async () => {
    existsSync.mockReturnValue(true);
    start.mockResolvedValue(undefined);

    await runScript();

    expect(copyFileSync).not.toHaveBeenCalled();
  });

  it('exits non-zero when the server does not start', async () => {
    existsSync.mockReturnValue(true);
    start.mockRejectedValue(new Error('port in use'));

    await runScript();

    expect(console.error).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
