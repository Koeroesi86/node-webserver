import type Worker from '../../index';
import type { WorkerEntry } from './create-worker-registry';
import startUnrefTimer from './start-unref-timer';
import WorkerStartError from './workerStartError';

interface WorkerTimersParams {
  /** how long a worker may take to say it is ready, in milliseconds, 0 for no handshake */
  startTimeout: number;
  /** in milliseconds, 0 for no limit */
  maxAge: number;
  /** in milliseconds, 0 for no limit */
  idleTimeout: number;
  /** the worker reached its maximum age */
  onAge: (worker: Worker) => void;
  /** the worker had no request for the idle timeout */
  onIdle: (worker: Worker) => void;
}

/** Starts the timers of a worker, each only when its limit is set. They do not keep the process alive. */
const createWorkerTimers = ({ startTimeout, maxAge, idleTimeout, onAge, onIdle }: WorkerTimersParams) => ({
  /** a worker that does not say it is ready is killed, which counts as a crash of its path */
  start: (worker: Worker, entry: WorkerEntry): NodeJS.Timeout | undefined =>
    entry.readiness === undefined
      ? undefined
      : startUnrefTimer(() => {
          entry.readiness?.reject(new WorkerStartError(entry.workerPath, `it was not ready within ${startTimeout}ms`));
          worker.terminate('SIGKILL');
        }, startTimeout),

  age: (worker: Worker): NodeJS.Timeout | undefined => (maxAge > 0 ? startUnrefTimer(() => onAge(worker), maxAge) : undefined),

  /** a worker that gets no request at all is stopped as well */
  idle: (worker: Worker): NodeJS.Timeout | undefined => (idleTimeout > 0 ? startUnrefTimer(() => onIdle(worker), idleTimeout) : undefined),
});

export default createWorkerTimers;
