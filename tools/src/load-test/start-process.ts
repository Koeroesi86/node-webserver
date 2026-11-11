import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import type { RunningProcess } from '../types/server';

/** starts a command with its output in a log file, the promise is settled when it exits, whatever the exit code is */
export const startProcess = ([command, ...args]: string[], logPath: string, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): RunningProcess => {
  const log = openSync(logPath, 'w');
  // the environment is passed on explicitly, so that changes to it are seen by the command
  const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ['ignore', log, log] });
  const exited = new Promise<void>((done) => {
    child.once('exit', () => done());
    child.once('error', (error) => {
      console.error(`${command} could not be started: ${error.message}`);
      done();
    });
  }).finally(() => closeSync(log));

  return { process: child, exited };
};
