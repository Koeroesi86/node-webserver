import type { SpawnOptions } from '../utils/spawn-worker';
import type { WorkerBudget } from './budget';

export interface WorkerPoolParams {
  overallLimit?: number;
  /** how long a request may wait for a worker when none can be started, in milliseconds */
  acquireTimeout?: number;
  /** how many requests may wait for a worker, the next ones are refused at once. 0 for no limit. */
  maxQueue?: number;
  onExit?: (code: number, workerPath: string, id: string) => void;
  /** receive what the workers write to their stdout and stderr, attached once when a worker starts */
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
  /** when a worker that crashed is started again, see `WorkerRestartBackoff` and `WorkerMinUptime` */
  restartBackoff?: { minUptime: number; base: number; max: number };
  /** a worker that has not had a request for this long is stopped, in milliseconds. 0 keeps idle workers running. */
  idleTimeout?: number;
  /** a limit shared with other pools, on top of `overallLimit` */
  budget?: WorkerBudget;
}

export interface WorkerRequest {
  workerPath: string;
  options: SpawnOptions;
  limit: number;
}
