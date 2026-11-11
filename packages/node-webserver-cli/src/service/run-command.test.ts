import runCommand from './run-command';

describe('runCommand', () => {
  it('resolves on exit code 0', async () => {
    await expect(runCommand(process.execPath, ['-e', ''])).resolves.toBeUndefined();
  });

  it('rejects with the output of a failing command', async () => {
    await expect(runCommand(process.execPath, ['-e', 'console.error("nope"); process.exit(3)'])).rejects.toThrow('failed: nope');
  });

  it('rejects when the command does not exist', async () => {
    await expect(runCommand('nws-no-such-command', [])).rejects.toThrow('failed');
  });
});
