const manageService = jest.fn();

jest.mock('../utils/manage-service', () => ({ __esModule: true, default: (...args: unknown[]) => manageService(...args) }));

describe('manageService script', () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    jest.resetModules();
    manageService.mockReset();
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

  it('passes the arguments after the script and leaves the exit code alone on success', async () => {
    process.argv = ['node', 'manage-service.js', '--add', '--configuration', 'c.js'];
    manageService.mockResolvedValue(undefined);

    await runScript();

    expect(manageService).toHaveBeenCalledWith(['--add', '--configuration', 'c.js']);
    expect(process.exitCode).toBeUndefined();
  });

  it('prints the message and exits non-zero when the action fails', async () => {
    process.argv = ['node', 'manage-service.js', '--add'];
    manageService.mockRejectedValue(new Error('run this as root'));

    await runScript();

    expect(console.error).toHaveBeenCalledWith('run this as root');
    expect(process.exitCode).toBe(1);
  });
});
