import { v4 as uuid } from 'uuid';
import path from 'path';
import Worker from '@koeroesi86/node-worker';
import type { WorkerOutputEvent } from '../types';

const pools: WorkerPool[] = [];

process.once('exit', () => {
  pools.forEach((pool) => pool.onClose());
});

const createWorkerCommand = (workerPath) => {
  const ext = path.extname(workerPath);
  switch (ext) {
    case '.js':
    default:
      return `node --expose-gc ${path.resolve(__dirname, './workerInvoke.js')} ${workerPath}`;
  }
};

interface WorkerPoolParams {
  overallLimit?: number;
  idleCheckTimeout?: number;
  /** how long a request may wait for a worker when none can be started, in milliseconds */
  acquireTimeout?: number;
  onExit?: (code: number, workerPath: string, id: string) => void;
}

/** A worker handed out for one request, it counts as load for the worker until it is released. */
export interface WorkerLease {
  readonly worker: Worker;
  /** `onMessage` receives the messages of the worker for the request, `onExit` is called when the worker dies before the lease is released */
  subscribe: (requestId: string, onMessage: (message: WorkerOutputEvent) => void, onExit: (code: number | null) => void) => void;
  /** frees the worker for other requests, safe to call more than once */
  release: () => void;
}

interface LeaseState {
  requestId?: string;
  onMessage?: (message: WorkerOutputEvent) => void;
  onExit?: (code: number | null) => void;
}

class WorkerPool {
  protected readonly overallLimit: number;
  protected readonly idleCheckTimeout: number;
  protected readonly acquireTimeout: number;
  protected readonly onExit: (code: number, workerPath: string, id: string) => void;
  protected readonly workers: Map<string, Map<string, Worker>>;
  private readonly leases: Map<Worker, Set<LeaseState>>;
  private readonly subscriptions: Map<string, LeaseState>;
  private readonly cursors: Map<string, number>;

  constructor({ overallLimit = 0, idleCheckTimeout = 5, acquireTimeout = 10000, onExit = () => {} }: WorkerPoolParams) {
    this.overallLimit = overallLimit;
    this.idleCheckTimeout = idleCheckTimeout;
    this.acquireTimeout = acquireTimeout;
    this.onExit = onExit;
    this.workers = new Map();
    this.leases = new Map();
    this.subscriptions = new Map();
    this.cursors = new Map();
    pools.push(this);
  }

  onClose = () => {
    this.workers.forEach((current) => current.forEach((worker) => worker.terminate()));
  };

  getWorkerCountForPath = (p) => {
    return this.workers.get(p)?.size ?? 0;
  };

  getWorkerCount = () => {
    return Array.from(this.workers.values()).reduce((result, current) => current.size + result, 0);
  };

  private getLoad = (worker: Worker) => this.leases.get(worker)?.size ?? 0;

  private belowOverallLimit = () => this.overallLimit <= 0 || this.getWorkerCount() < this.overallLimit;

  /** the worker with the fewest running requests, the ones tied on load take turns */
  private pickLeastLoaded = (workerPath: string, candidates: Worker[]): Worker | undefined => {
    const lowest = Math.min(...candidates.map(this.getLoad));
    const tied = candidates.filter((worker) => this.getLoad(worker) === lowest);
    const cursor = this.cursors.get(workerPath) ?? 0;
    this.cursors.set(workerPath, cursor + 1);

    return tied[cursor % tied.length];
  };

  /**
   * Makes room under the overall limit for the first worker of a path, by stopping an idle worker of the path that has the most.
   * Paths are never left without a worker this way, so one busy path cannot starve the others.
   */
  private evictIdleWorker = (excludedPath: string): boolean => {
    const victim = Array.from(this.workers.entries())
      .filter(([workerPath, current]) => workerPath !== excludedPath && current.size > 1)
      .sort(([, a], [, b]) => b.size - a.size)
      .flatMap(([, current]) =>
        Array.from(current.entries())
          .filter(([, worker]) => this.getLoad(worker) === 0)
          .slice(0, 1)
          .map(([id, worker]) => ({ current, id, worker }))
      )[0];

    if (victim === undefined) {
      return false;
    }

    // the close event is asynchronous, so the registry is updated right away to free the slot
    victim.current.delete(victim.id);
    victim.worker.terminate();
    return true;
  };

  private createWorker = (workerPath: string, options): Worker => {
    const id = uuid();
    const instance = new Worker(createWorkerCommand(workerPath), options);
    const workersForPath = this.workers.get(workerPath) ?? new Map<string, Worker>();
    this.workers.set(workerPath, workersForPath);
    this.leases.set(instance, new Set());

    // a single listener dispatches the messages of all requests of the worker
    instance.addEventListener('message', (message: WorkerOutputEvent) => this.subscriptions.get(message?.requestId)?.onMessage?.(message));

    instance.addEventListenerOnce('close', (code: number) => {
      const states = Array.from(this.leases.get(instance) ?? []);
      workersForPath.delete(id);
      this.leases.delete(instance);
      states.forEach((state) => {
        this.subscriptions.delete(state.requestId);
        state.onExit?.(code);
      });
      this.onExit(code, workerPath, id);
    });

    workersForPath.set(id, instance);

    return instance;
  };

  private tryGetWorker = (workerPath: string, options, limit: number): Worker | undefined => {
    const candidates = Array.from(this.workers.get(workerPath)?.values() ?? []).filter((worker) => worker.instance.exitCode === null);
    const leastLoaded = candidates.length > 0 ? this.pickLeastLoaded(workerPath, candidates) : undefined;

    if (leastLoaded !== undefined && this.getLoad(leastLoaded) === 0) {
      return leastLoaded;
    }

    // another worker is only started when all the running ones are busy
    const belowPathLimit = candidates.length < Math.max(limit, 1);
    const hasRoom = this.belowOverallLimit() || (candidates.length === 0 && this.evictIdleWorker(workerPath));

    return belowPathLimit && hasRoom ? this.createWorker(workerPath, options) : leastLoaded;
  };

  /** Starts workers for the path ahead of its first request, so that one does not have to wait for a process to start. */
  warm = (workerPath: string, options = {}, count = 1) => {
    while (this.getWorkerCountForPath(workerPath) < count && this.belowOverallLimit()) {
      this.createWorker(workerPath, options);
    }
  };

  /**
   * Hands out a worker for the path: an idle one, otherwise a new one while fewer than `limit` run for the path, otherwise the least busy.
   * A limit of 0 (or less) keeps a single worker for the path.
   * Rejects when no worker could be started within the acquire timeout, as the overall limit is used up by other paths.
   */
  acquire = async (workerPath: string, options = {}, limit = 0): Promise<WorkerLease> => {
    const deadline = Date.now() + this.acquireTimeout;
    let worker = this.tryGetWorker(workerPath, options, limit);

    while (worker === undefined) {
      if (Date.now() >= deadline) {
        throw new Error(`No worker became available for ${workerPath} within ${this.acquireTimeout}ms.`);
      }
      await new Promise((r) => setTimeout(r, this.idleCheckTimeout));
      worker = this.tryGetWorker(workerPath, options, limit);
    }

    const state: LeaseState = {};
    const leased = worker;
    this.leases.get(leased).add(state);

    return {
      worker: leased,
      subscribe: (requestId, onMessage, onExit) => {
        Object.assign(state, { requestId, onMessage, onExit });
        this.subscriptions.set(requestId, state);
      },
      release: () => {
        this.leases.get(leased)?.delete(state);
        if (state.requestId !== undefined && this.subscriptions.get(state.requestId) === state) {
          this.subscriptions.delete(state.requestId);
        }
      },
    };
  };
}

export default WorkerPool;
