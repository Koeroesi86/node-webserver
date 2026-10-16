import type { LeaseState, WorkerEntry, WorkerRegistry } from './create-worker-registry';
import type { WorkerUptime } from './watch-worker-uptime';
import type createRestartBackoff from './create-restart-backoff';

/** a worker whose process ended, and what the steps find out about it on the way */
export interface ClosedWorker<T extends object> {
  worker: T;
  entry: WorkerEntry;
  code: number;
  uptime: WorkerUptime;
  /** the requests that held the worker, set once it is out of the registry */
  leases: LeaseState[];
}

export type CloseStep<T extends object> = (closed: ClosedWorker<T>) => void;

interface CloseStepsParams<T extends object> {
  registry: WorkerRegistry<T, unknown>;
  restartBackoff: ReturnType<typeof createRestartBackoff>;
  /** the workers that the pool stops itself, which is no crash */
  isStopping: (worker: T) => boolean;
  onExit: (code: number, workerPath: string, id: string) => void;
  /** there is room for another worker now, and the requests that wait may get one, also in the other pools of the budget */
  wakeUp: () => void;
  checkDisposed: () => void;
  /** starts the paths that are kept warm again */
  refillWarmPaths: () => void;
}

/** The steps when a worker ends, in order: waiting requests (of every pool of the budget) first, then the warm paths take the room left. */
const createWorkerCloseSteps = <T extends object>({
  registry,
  restartBackoff,
  isStopping,
  onExit,
  wakeUp,
  checkDisposed,
  refillWarmPaths,
}: CloseStepsParams<T>): CloseStep<T>[] => [
  function stopTimers({ entry, uptime }) {
    uptime.stop();
    clearTimeout(entry.idleTimer);
  },
  function recordCrash({ worker, entry, code, uptime }) {
    if (!isStopping(worker) && (!uptime.isStable() || code)) restartBackoff.recordFailure(entry.workerPath);
  },
  function removeFromRegistry(closed) {
    closed.leases = registry.remove(closed.worker);
  },
  function notifyRequests({ code, leases }) {
    leases.forEach((state) => state.onExit?.(code));
  },
  function reportExit({ code, entry }) {
    onExit(code, entry.workerPath, entry.id);
  },
  function wakeWaiting() {
    wakeUp();
  },
  function checkPoolDisposed() {
    checkDisposed();
  },
  // a worker that the pool stopped itself is not replaced: it made room for another worker, or the pool is going away
  function refillWarmPathsUnlessStopped({ worker }) {
    if (!isStopping(worker)) refillWarmPaths();
  },
];

export default createWorkerCloseSteps;
