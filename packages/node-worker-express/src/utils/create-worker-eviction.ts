import pickIdleWorker from './pick-idle-worker';
import type { IdleWorker } from '../types';

export type EvictionReason = 'idle' | 'forRoom';

interface WorkerEviction<T> {
  workers: Map<string, Map<string, T>>;
  /** what the pool knows about the worker */
  getEntry: (worker: T) => { workerPath: string; id: string; lastUsed: number };
  getLoad: (worker: T) => number;
  /** a path without workers keeps no state, so that many paths that were asked for once do not add up */
  forgetPath: (workerPath: string) => void;
  stop: (worker: T) => void;
}

/** Stops the idle workers of a pool, when they had no request for the idle timeout or to make room, and counts them. */
const createWorkerEviction = <T>({ workers, getEntry, getLoad, forgetPath, stop }: WorkerEviction<T>) => {
  const evicted = { idle: 0, forRoom: 0 };

  /** takes the worker out of the registry right away, the close event is asynchronous and the slot is free now */
  const evict = (worker: T, reason: EvictionReason) => {
    const { workerPath, id } = getEntry(worker);
    const current = workers.get(workerPath);
    current?.delete(id);
    if (current?.size === 0) forgetPath(workerPath);
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
        Array.from(workers.values()).flatMap((current) =>
          Array.from(current.values())
            .filter((worker) => getLoad(worker) === 0)
            .map((worker) => ({ spare: current.size > 1, lastUsed: getEntry(worker).lastUsed, stop: () => evict(worker, 'forRoom') }))
        )
      ),
    getStats: () => ({ ...evicted }),
  };
};

export default createWorkerEviction;
