import type { ChildProcess } from 'node:child_process';

/** a process that was started, and the promise that is settled when it exits */
export interface RunningProcess {
  process: ChildProcess;
  exited: Promise<void>;
}
