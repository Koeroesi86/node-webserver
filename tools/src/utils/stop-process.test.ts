import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProcess } from './start-process';
import { stopProcess } from './stop-process';

describe('stopProcess', () => {
  const folder = mkdtempSync(join(tmpdir(), 'stop-process-'));

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('stops a process that runs, and returns when it is gone', async () => {
    const running = startProcess([process.execPath, '-e', 'setInterval(() => undefined, 1000)'], join(folder, 'a.log'));

    await stopProcess(running);

    expect(running.process.exitCode !== null || running.process.signalCode !== null).toBe(true);
  });

  it('kills a process that does not leave when it is asked to, after the time it was given', async () => {
    const logPath = join(folder, 'stubborn.log');
    const running = startProcess(
      [process.execPath, '-e', "process.on('SIGTERM', () => undefined); console.log('ready'); setInterval(() => undefined, 1000)"],
      logPath
    );
    // the process has to ignore the signal, so it is only asked once it said that it does
    while (!readFileSync(logPath, 'utf8').includes('ready')) await new Promise((done) => setTimeout(done, 20));

    await stopProcess(running, 200);

    expect(running.process.signalCode).toBe('SIGKILL');
  });

  it('does nothing for a process that has exited', async () => {
    const running = startProcess([process.execPath, '-e', ''], join(folder, 'b.log'));
    await running.exited;

    await expect(stopProcess(running)).resolves.toBeUndefined();
  });
});
