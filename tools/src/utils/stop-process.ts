import { setTimeout as sleep } from 'node:timers/promises';
import { serverStopTimeoutMs } from '../constants/load-test';
import type { RunningProcess } from '../types/server';

/** asks the process to leave, and kills it when it does not in time. The workers and lambdas of a server leave when the server does, so its port is free when it is gone */
export const stopProcess = async ({ process: child, exited }: RunningProcess, timeoutMs = serverStopTimeoutMs) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(timeoutMs, undefined, { ref: false })]);
  child.kill('SIGKILL');
  await exited;
};
