import type net from 'net';
import type { HandBackMessage, WorkerOutputEvent } from '../types';

/** what the pool knows about a worker besides its requests */
export interface WorkerEntry {
  workerPath: string;
  id: string;
  lastUsed: number;
  /** restarted whenever the worker finishes its last request, it stops the worker when it fires */
  idleTimer?: NodeJS.Timeout;
}

/** a request that holds a worker, and where the messages of the worker for it go to */
export interface LeaseState {
  requestId?: string;
  onMessage?: (message: WorkerOutputEvent) => void;
  onHandBack?: (message: HandBackMessage, socket: net.Socket) => void;
  onExit?: (code: number | null) => void;
}

/**
 * Holds what the pool keeps per worker: the workers of a path, their entries, channels and leases, the subscriptions of the requests and the turns of the paths.
 * The maps are only changed here, so that a worker that goes away is gone from all of them.
 */
const createWorkerRegistry = <T extends object, C>() => {
  const workers = new Map<string, Map<string, T>>();
  const entries = new Map<T, WorkerEntry>();
  const channels = new Map<T, C>();
  const leases = new Map<T, Set<LeaseState>>();
  const subscriptions = new Map<string, LeaseState>();
  const cursors = new Map<string, number>();

  const getLoad = (worker: T) => leases.get(worker)?.size ?? 0;

  /** a path without workers keeps no state, so that many paths that were asked for once do not add up */
  const forgetPathIfEmpty = (workerPath: string) => {
    if (workers.get(workerPath)?.size !== 0) return;

    workers.delete(workerPath);
    cursors.delete(workerPath);
  };

  /** takes the worker out of the workers of its path, so that it gets no more requests. Its entry, channel and leases stay until `remove`. */
  const unlist = (worker: T) => {
    const entry = entries.get(worker);
    if (entry === undefined) return;

    workers.get(entry.workerPath)?.delete(entry.id);
    forgetPathIfEmpty(entry.workerPath);
  };

  const unsubscribe = (state: LeaseState) => {
    if (state.requestId !== undefined && subscriptions.get(state.requestId) === state) subscriptions.delete(state.requestId);
  };

  return {
    add: (worker: T, entry: WorkerEntry, channel: C) => {
      const current = workers.get(entry.workerPath) ?? new Map<string, T>();
      workers.set(entry.workerPath, current);
      current.set(entry.id, worker);
      entries.set(worker, entry);
      channels.set(worker, channel);
      leases.set(worker, new Set());
    },
    unlist,
    /** forgets the worker everywhere and returns the requests that held it */
    remove: (worker: T): LeaseState[] => {
      const states = Array.from(leases.get(worker) ?? []);
      unlist(worker);
      leases.delete(worker);
      channels.delete(worker);
      entries.delete(worker);
      states.forEach(unsubscribe);

      return states;
    },
    getEntry: (worker: T) => entries.get(worker),
    getChannel: (worker: T) => channels.get(worker),
    getLoad,
    /** counts the request as a load of the worker */
    addLease: (worker: T, state: LeaseState) => leases.get(worker)?.add(state),
    removeLease: (worker: T, state: LeaseState) => {
      leases.get(worker)?.delete(state);
      unsubscribe(state);
    },
    subscribe: (state: LeaseState, requestId: string) => {
      state.requestId = requestId;
      subscriptions.set(requestId, state);
    },
    getSubscription: (requestId: string) => subscriptions.get(requestId),
    getWorkersForPath: (workerPath: string) => Array.from(workers.get(workerPath)?.values() ?? []),
    getWorkerCountForPath: (workerPath: string) => workers.get(workerPath)?.size ?? 0,
    getWorkerCount: () => Array.from(workers.values()).reduce((result, current) => result + current.size, 0),
    /** the workers per path */
    getGroups: () => Array.from(workers.values()).map((current) => Array.from(current.values())),
    getWorkers: () => Array.from(workers.values()).flatMap((current) => Array.from(current.values())),
    /** the requests that are being handled by a worker */
    getActive: () => Array.from(leases.values()).reduce((result, current) => result + current.size, 0),
    getPathStats: () =>
      Object.fromEntries(
        Array.from(workers.entries()).map(([workerPath, current]) => [
          workerPath,
          { workers: current.size, active: Array.from(current.values()).reduce((result, worker) => result + getLoad(worker), 0) },
        ])
      ),
    /** the turn of the next pick among the workers of a path that are tied */
    nextCursor: (workerPath: string) => {
      const cursor = cursors.get(workerPath) ?? 0;
      cursors.set(workerPath, cursor + 1);

      return cursor;
    },
  };
};

export type WorkerRegistry<T extends object, C> = ReturnType<typeof createWorkerRegistry<T, C>>;

export default createWorkerRegistry;
