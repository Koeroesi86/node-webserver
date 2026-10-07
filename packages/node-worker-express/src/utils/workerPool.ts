import { v4 as uuid } from 'uuid';
import path from 'path';
import Worker from '@koeroesi86/node-worker';
import { WorkerMinUptime, WorkerRestartBackoff } from '../constants';
import WorkerUnavailableError from './workerUnavailableError';
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
  /** receive what the workers write to their stdout and stderr, attached once when a worker starts */
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
  /** when a worker that crashed is started again, see `WorkerRestartBackoff` and `WorkerMinUptime` */
  restartBackoff?: { minUptime: number; base: number; max: number };
}

/** the options to spawn a worker with, or a function that makes them: building them can be costly (the environment is copied), and it is only needed when a worker is started */
export type SpawnOptions = object | (() => object);

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
  /** the workers that crashed in a row per path, and when another one may be started */
  private readonly failures: Map<string, { count: number; retryAt: number }>;
  /** the workers that the pool stops itself, which is no crash */
  private readonly stopping: WeakSet<Worker>;
  private readonly onStdout?: (data: Buffer) => void;
  private readonly onStderr?: (data: Buffer) => void;
  private readonly restartBackoff: { minUptime: number; base: number; max: number };
  /** requests that are waiting for a worker to become available */
  private waiting = 0;

  constructor({
    overallLimit = 0,
    idleCheckTimeout = 5,
    acquireTimeout = 10000,
    onExit = () => {},
    onStdout,
    onStderr,
    restartBackoff = { minUptime: WorkerMinUptime, ...WorkerRestartBackoff },
  }: WorkerPoolParams) {
    this.overallLimit = overallLimit;
    this.idleCheckTimeout = idleCheckTimeout;
    this.acquireTimeout = acquireTimeout;
    this.onExit = onExit;
    this.onStdout = onStdout;
    this.onStderr = onStderr;
    this.restartBackoff = restartBackoff;
    this.failures = new Map();
    this.stopping = new WeakSet();
    this.workers = new Map();
    this.leases = new Map();
    this.subscriptions = new Map();
    this.cursors = new Map();
    pools.push(this);
  }

  /** stops a worker, which is not a crash */
  private stop = (worker: Worker) => {
    this.stopping.add(worker);
    worker.terminate();
  };

  onClose = () => {
    this.workers.forEach((current) => current.forEach(this.stop));
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
    this.stop(victim.worker);
    return true;
  };

  /** a second crash in a row, and every one after it, holds back the next start for longer */
  private recordFailure = (workerPath: string) => {
    const count = (this.failures.get(workerPath)?.count ?? 0) + 1;
    const delay = count < 2 ? 0 : Math.min(this.restartBackoff.max, this.restartBackoff.base * 2 ** (count - 2));
    this.failures.set(workerPath, { count, retryAt: Date.now() + delay });
  };

  /** how long a worker for the path may not be started, 0 when it may */
  private getBackoff = (workerPath: string) => Math.max(0, (this.failures.get(workerPath)?.retryAt ?? 0) - Date.now());

  private createWorker = (workerPath: string, options: SpawnOptions): Worker => {
    const id = uuid();
    const instance = new Worker(createWorkerCommand(workerPath), typeof options === 'function' ? options() : options);
    const workersForPath = this.workers.get(workerPath) ?? new Map<string, Worker>();
    this.workers.set(workerPath, workersForPath);
    this.leases.set(instance, new Set());

    // a single listener dispatches the messages of all requests of the worker
    instance.addEventListener('message', (message: WorkerOutputEvent) => this.subscriptions.get(message?.requestId)?.onMessage?.(message));

    // once for the worker, not for every request it gets, and from the start, so that nothing it writes waits unread in the pipe
    if (this.onStdout) instance.instance.stdout?.on('data', this.onStdout);
    if (this.onStderr) instance.instance.stderr?.on('data', this.onStderr);

    // a worker that has been up for a while is healthy, whatever the ones before it did
    let stable = false;
    const stableTimer = setTimeout(() => {
      stable = true;
      this.failures.delete(workerPath);
    }, this.restartBackoff.minUptime);
    stableTimer.unref();

    instance.addEventListenerOnce('close', (code: number) => {
      clearTimeout(stableTimer);
      if (!this.stopping.has(instance) && (!stable || code)) {
        this.recordFailure(workerPath);
      }
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

  private tryGetWorker = (workerPath: string, options: SpawnOptions, limit: number): Worker | undefined => {
    const candidates = Array.from(this.workers.get(workerPath)?.values() ?? []).filter((worker) => worker.instance.exitCode === null);
    const leastLoaded = candidates.length > 0 ? this.pickLeastLoaded(workerPath, candidates) : undefined;

    if (leastLoaded !== undefined && this.getLoad(leastLoaded) === 0) {
      return leastLoaded;
    }

    // a path whose workers keep crashing gets no new one for a while: the busy ones that still run take the request, and without one it is refused
    const backoff = this.getBackoff(workerPath);
    if (backoff > 0 && leastLoaded !== undefined) {
      return leastLoaded;
    }
    if (backoff > 0) {
      throw new WorkerUnavailableError(workerPath, backoff);
    }

    // another worker is only started when all the running ones are busy
    const belowPathLimit = candidates.length < Math.max(limit, 1);
    const hasRoom = this.belowOverallLimit() || (candidates.length === 0 && this.evictIdleWorker(workerPath));

    return belowPathLimit && hasRoom ? this.createWorker(workerPath, options) : leastLoaded;
  };

  /** Starts workers for the path ahead of its first request, so that one does not have to wait for a process to start. */
  warm = (workerPath: string, options: SpawnOptions = {}, count = 1) => {
    while (this.getWorkerCountForPath(workerPath) < count && this.belowOverallLimit() && this.getBackoff(workerPath) === 0) {
      this.createWorker(workerPath, options);
    }
  };

  /** keeps trying until a worker is available, rejects when none could be started within the acquire timeout */
  private waitForWorker = async (workerPath: string, options: SpawnOptions, limit: number): Promise<Worker> => {
    const deadline = Date.now() + this.acquireTimeout;
    this.waiting += 1;

    try {
      for (;;) {
        if (Date.now() >= deadline) {
          throw new Error(`No worker became available for ${workerPath} within ${this.acquireTimeout}ms.`);
        }
        await new Promise((r) => setTimeout(r, this.idleCheckTimeout));
        const worker = this.tryGetWorker(workerPath, options, limit);
        if (worker !== undefined) return worker;
      }
    } finally {
      this.waiting -= 1;
    }
  };

  /** what the pool is doing right now, for metrics */
  getStats = () => ({
    workers: this.getWorkerCount(),
    /** requests that are being handled by a worker */
    active: Array.from(this.leases.values()).reduce((result, current) => result + current.size, 0),
    /** requests that wait for a worker */
    waiting: this.waiting,
    /** the paths whose workers crashed in a row, with the number of crashes and the time until another one is started */
    failing: Object.fromEntries(
      Array.from(this.failures.entries()).map(([workerPath, { count }]) => [workerPath, { crashes: count, retryInMs: this.getBackoff(workerPath) }])
    ),
    paths: Object.fromEntries(
      Array.from(this.workers.entries()).map(([workerPath, current]) => [
        workerPath,
        { workers: current.size, active: Array.from(current.values()).reduce((result, worker) => result + this.getLoad(worker), 0) },
      ])
    ),
  });

  /**
   * Hands out a worker for the path: an idle one, otherwise a new one while fewer than `limit` run for the path, otherwise the least busy.
   * A limit of 0 (or less) keeps a single worker for the path.
   * Rejects when no worker could be started within the acquire timeout, as the overall limit is used up by other paths.
   */
  acquire = async (workerPath: string, options: SpawnOptions = {}, limit = 0): Promise<WorkerLease> => {
    const worker = this.tryGetWorker(workerPath, options, limit) ?? (await this.waitForWorker(workerPath, options, limit));

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
