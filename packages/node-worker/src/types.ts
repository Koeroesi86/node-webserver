import type { SpawnOptions } from 'child_process';

export interface WorkerOptions extends SpawnOptions {
  /** flags for the executable, placed right after it: a file with spaces in its path cannot be passed that way inside a command string */
  execArgv?: string[];
}
