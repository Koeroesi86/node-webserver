import pickIdleWorker from './pick-idle-worker';
import type { IdleWorker } from '../types';

export type EvictionReason = 'idle' | 'forRoom';

interface WorkerEviction<T> {
  /** the workers per path */
  getGroups: () => T[][];
  /** what the pool knows about the worker */
  getEntry: (worker: T) => { lastUsed: number } | undefined;
  getLoad: (worker: T) => number;
  /** takes the worker out of the workers of its path, which forgets a path that has no worker left */
  unlist: (worker: T) => void;
  stop: (worker: T) => void;
}

/** Stops the idle workers of a pool, when they had no request for the idle timeout or to make room, and counts them. */
const createWorkerEviction = <T>({ getGroups, getEntry, getLoad, unlist, stop }: WorkerEviction<T>) => {
  const evicted = { idle: 0, forRoom: 0 };

  /** takes the worker out of the registry right away, the close event is asynchronous and the slot is free now */
  const evict = (worker: T, reason: EvictionReason) => {
    unlist(worker);
    evicted[reason] += 1;
    stop(worker);
  };

  return {
    evict,
    /**
     * The idle worker the pool gives up first to make room: a spare worker of a path before the last worker of one, the one used longest ago first.
     * The last worker of a path that still has requests is never taken, as only busy workers are left for it then, so one busy path cannot starve the others.
     */
    findIdleWorker: (): IdleWorker | undefined =>
      pickIdleWorker(
        getGroups().flatMap((current) =>
          current
            .filter((worker) => getLoad(worker) === 0)
            .map((worker) => ({ spare: current.length > 1, lastUsed: getEntry(worker)?.lastUsed ?? 0, stop: () => evict(worker, 'forRoom') }))
        )
      ),
    getStats: () => ({ ...evicted }),
  };
};

export default createWorkerEviction;
