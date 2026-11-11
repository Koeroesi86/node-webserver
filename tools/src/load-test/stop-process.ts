import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { serverStopTimeoutMs } from '../constants/load-test';
import type { RunningProcess } from '../types/server';

/**
 * Windows has no signals, kill() ends that process only. The workers and lambdas of a server would stay behind, and with the pipes of the step they run in
 * that step does not finish while they live. taskkill ends the process with all it started.
 */
const killTree = (pid: number | undefined) => pid !== undefined && spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });

/** asks the process to leave, and kills it when it does not in time. The workers and lambdas of a server leave when the server does, so its port is free when it is gone */
export const stopProcess = async ({ process: child, exited }: RunningProcess, timeoutMs = serverStopTimeoutMs) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    killTree(child.pid);
    await exited;
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(timeoutMs, undefined, { ref: false })]);
  child.kill('SIGKILL');
  await exited;
};
