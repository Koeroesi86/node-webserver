import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProcess } from './start-process';

describe('startProcess', () => {
  const folder = mkdtempSync(join(tmpdir(), 'start-process-'));

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('writes the output to the log, and settles when the command exits', async () => {
    const { exited } = startProcess([process.execPath, '-e', "console.log('out'); console.error('err')"], join(folder, 'a.log'));
    await exited;

    expect(readFileSync(join(folder, 'a.log'), 'utf8')).toContain('out');
    expect(readFileSync(join(folder, 'a.log'), 'utf8')).toContain('err');
  });

  it('passes the environment and the folder on', async () => {
    await startProcess([process.execPath, '-e', 'console.log(process.env.GREETING, process.cwd())'], join(folder, 'b.log'), {
      cwd: folder,
      env: { GREETING: 'hello' },
    }).exited;

    expect(readFileSync(join(folder, 'b.log'), 'utf8')).toContain('hello');
  });

  it('settles with a message when the command does not exist', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await startProcess(['no-such-command-here'], join(folder, 'c.log')).exited;

    expect(error).toHaveBeenCalledWith(expect.stringContaining('could not be started'));
    error.mockRestore();
  });
});
