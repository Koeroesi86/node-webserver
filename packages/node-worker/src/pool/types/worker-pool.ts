import type { SpawnOptions } from '../utils';
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
  /** the executable and arguments that run a worker file. By default node runs the file through `workerInvoke.js`. */
  createCommand?: (workerPath: string) => string[];
  /** how many requests one worker takes at the same time, the next ones wait in line for a request to end. 0 for no limit. */
  concurrency?: number;
  /**
   * How long a worker may take to send `READY` after it started, in milliseconds. A worker that does not is killed, which counts as a crash,
   * and the requests that were given it fail with a `WorkerStartError`. 0 does not wait for the handshake: workers are ready as they start.
   */
  startTimeout?: number;
  /** a worker that is older than this is not given requests any more and stopped as soon as it is idle, never in the middle of a request. In milliseconds, 0 for no limit. */
  maxAge?: number;
  /** the signal that stops a worker the pool ends, `SIGINT` by default */
  stopSignal?: NodeJS.Signals;
  /** a worker that is still there this long after it was asked to stop is killed. In milliseconds, 0 keeps waiting. */
  killAfter?: number;
  /** called for every worker before it starts, see `PreparedWorker` */
  prepareWorker?: (context: { workerPath: string; id: string }) => PreparedWorker;
}

/** what a pool starts a worker with besides the options of the request, and what it does once the worker is gone: folders, flags for node, the environment */
export interface PreparedWorker {
  /** spawn options that replace the ones of the request, `env` as a whole */
  options?: object;
  /** called once when the worker ended, or could not be started */
  onClose?: () => void;
}

export interface WorkerRequest {
  workerPath: string;
  options: SpawnOptions;
  limit: number;
}
