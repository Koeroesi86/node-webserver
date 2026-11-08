const forwardToCli = jest.fn();

jest.mock('../utils', () => ({ forwardToCli: (...args: unknown[]) => forwardToCli(...args) }));

describe('manageService script', () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    jest.resetModules();
    forwardToCli.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    jest.restoreAllMocks();
  });

  const runScript = async () => {
    jest.isolateModules(() => {
      require('./manage-service');
    });
    await new Promise(process.nextTick);
  };

  it('passes the arguments after the script on and leaves the exit code alone on success', async () => {
    process.argv = ['node', 'manage-service.js', '--add', '--configuration', 'c.js'];
    forwardToCli.mockResolvedValue(undefined);

    await runScript();

    expect(forwardToCli).toHaveBeenCalledWith(['--add', '--configuration', 'c.js']);
    expect(process.exitCode).toBeUndefined();
  });

  it('prints the message and exits non-zero when forwarding fails', async () => {
    process.argv = ['node', 'manage-service.js', '--user'];
    forwardToCli.mockRejectedValue(new Error('--user goes with --add or --remove.'));

    await runScript();

    expect(console.error).toHaveBeenCalledWith('--user goes with --add or --remove.');
    expect(process.exitCode).toBe(1);
  });
});
