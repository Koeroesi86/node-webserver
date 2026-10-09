import { v4 as uuid } from 'uuid';
import path from 'path';
import { Duplex } from 'stream';
import Worker from '@koeroesi86/node-worker';
import createChannel from './createChannel';
import type { Channel } from './createChannel';
import { WorkerMinUptime, WorkerRestartBackoff } from '../constants';
import WorkerBusyError from './workerBusyError';
import WorkerUnavailableError from './workerUnavailableError';
import WorkerAbandonedError from './workerAbandonedError';
import type { WorkerInputEvent, WorkerOutputEvent } from '../types';

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
}

/** the options to spawn a worker with, or a function that makes them: building them can be costly (the environment is copied), and it is only needed when a worker is started */
export type SpawnOptions = object | (() => object);

/** A worker handed out for one request, it counts as load for the worker until it is released. */
export interface WorkerLease {
  readonly worker: Worker;
  /** sends a message to the worker */
  send: (message: WorkerInputEvent) => void;
  /** `onMessage` receives the messages of the worker for the request, `onExit` is called when the worker dies before the lease is released */
  subscribe: (requestId: string, onMessage: (message: WorkerOutputEvent) => void, onExit: (code: number | null) => void) => void;
  /** frees the worker for other requests, safe to call more than once */
  release: () => void;
}

/** a request that waits for a worker */
interface Waiter {
  workerPath: string;
  options: SpawnOptions;
  limit: number;
  resolve: (lease: WorkerLease) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface LeaseState {
  requestId?: string;
  onMessage?: (message: WorkerOutputEvent) => void;
  onExit?: (code: number | null) => void;
}

class WorkerPool {
  protected readonly overallLimit: number;
  protected readonly acquireTimeout: number;
  protected readonly onExit: (code: number, workerPath: string, id: string) => void;
  protected readonly workers: Map<string, Map<string, Worker>>;
  private readonly leases: Map<Worker, Set<LeaseState>>;
  private readonly channels: Map<Worker, Channel<WorkerInputEvent>>;
  private readonly subscriptions: Map<string, LeaseState>;
  private readonly cursors: Map<string, number>;
  /** the workers that crashed in a row per path, and when another one may be started */
  private readonly failures: Map<string, { count: number; retryAt: number }>;
  /** the workers that the pool stops itself, which is no crash */
  private readonly stopping: WeakSet<Worker>;
  private readonly onStdout?: (data: Buffer) => void;
  private readonly onStderr?: (data: Buffer) => void;
  private readonly restartBackoff: { minUptime: number; base: number; max: number };
  /** the requests that wait for a worker, in the order they came in */
  private readonly queue: Waiter[] = [];
  private readonly maxQueue: number;
  /** how many requests were refused because too many waited, and how many gave up after waiting too long, since the pool started */
  private refused = { queueFull: 0, timedOut: 0 };
  private abandoned = 0;

  constructor({
    overallLimit = 0,
    acquireTimeout = 10000,
    maxQueue = 0,
    onExit = () => {},
    onStdout,
    onStderr,
    restartBackoff = { minUptime: WorkerMinUptime, ...WorkerRestartBackoff },
  }: WorkerPoolParams) {
    this.overallLimit = overallLimit;
    this.acquireTimeout = acquireTimeout;
    this.maxQueue = maxQueue;
    this.onExit = onExit;
    this.onStdout = onStdout;
    this.onStderr = onStderr;
    this.restartBackoff = restartBackoff;
    this.failures = new Map();
    this.stopping = new WeakSet();
    this.workers = new Map();
    this.leases = new Map();
    this.channels = new Map();
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
    // the fourth stdio is the socket pair the messages go through, in place of the IPC channel of node that sends JSON.
    // 'overlapped' is a plain pipe except on Windows, where the worker could not read and write it at the same time otherwise
    const instance = new Worker(createWorkerCommand(workerPath), {
      ...(typeof options === 'function' ? options() : options),
      stdio: ['pipe', 'pipe', 'pipe', 'overlapped'],
    });
    const socket = instance.instance.stdio[3];
    if (!(socket instanceof Duplex)) {
      instance.terminate();
      throw new Error(`The worker ${workerPath} has no channel.`);
    }
    const workersForPath = this.workers.get(workerPath) ?? new Map<string, Worker>();
    this.workers.set(workerPath, workersForPath);
    this.leases.set(instance, new Set());

    // a single listener dispatches the messages of all requests of the worker
    this.channels.set(
      instance,
      createChannel<WorkerOutputEvent, WorkerInputEvent>(socket, (message) => this.subscriptions.get(message.requestId)?.onMessage?.(message))
    );

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
      this.channels.delete(instance);
      states.forEach((state) => {
        this.subscriptions.delete(state.requestId);
        state.onExit?.(code);
      });
      this.onExit(code, workerPath, id);
      // there is room for another worker now, and the requests that wait may get one
      this.wakeUp();
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
    this.wakeUp();
  };

  /** counts the request as a load of the worker right away, before anything else can look at the worker */
  private createLease = (leased: Worker): WorkerLease => {
    const state: LeaseState = {};
    this.leases.get(leased).add(state);

    return {
      worker: leased,
      send: (message) => this.channels.get(leased)?.send(message),
      subscribe: (requestId, onMessage, onExit) => {
        Object.assign(state, { requestId, onMessage, onExit });
        this.subscriptions.set(requestId, state);
      },
      release: () => {
        this.leases.get(leased)?.delete(state);
        if (state.requestId !== undefined && this.subscriptions.get(state.requestId) === state) {
          this.subscriptions.delete(state.requestId);
        }
        // a worker has room again, for the request that has waited longest
        this.wakeUp();
      },
    };
  };

  /** gives a worker to a waiting request if there is one for it, otherwise it keeps its place, and tells it when the worker is not to be had at all */
  private serve = (waiter: Waiter) => {
    try {
      const worker = this.tryGetWorker(waiter.workerPath, waiter.options, waiter.limit);
      if (worker === undefined) {
        this.queue.push(waiter);
        return;
      }
      clearTimeout(waiter.timer);
      waiter.resolve(this.createLease(worker));
    } catch (error) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  };

  /** looks at the requests that wait, in the order they came in, whenever a worker could have become available: a request that is finished, a worker that stopped or started */
  private wakeUp = () => {
    if (this.queue.length === 0) return;

    this.queue.splice(0).forEach(this.serve);
  };

  /** the request waits in line for a worker, for as long as the acquire timeout, unless too many wait already */
  private enqueue = (workerPath: string, options: SpawnOptions, limit: number, signal?: AbortSignal) =>
    new Promise<WorkerLease>((resolve, reject) => {
      if (this.maxQueue > 0 && this.queue.length >= this.maxQueue) {
        this.refused.queueFull += 1;
        reject(new WorkerBusyError(workerPath, `${this.queue.length} requests wait for a worker for ${workerPath} already.`));
        return;
      }

      if (signal?.aborted) {
        this.abandoned += 1;
        reject(new WorkerAbandonedError(workerPath));
        return;
      }

      // one timer for the time that the request waits, nothing polls
      const timer = setTimeout(() => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        this.refused.timedOut += 1;
        waiter.reject(new WorkerBusyError(workerPath, `No worker became available for ${workerPath} within ${this.acquireTimeout}ms.`));
      }, this.acquireTimeout);
      const onAbort = () => {
        clearTimeout(timer);
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        this.abandoned += 1;
        reject(new WorkerAbandonedError(workerPath));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const settle =
        <T>(settleWaiter: (value: T) => void) =>
        (value: T) => {
          signal?.removeEventListener('abort', onAbort);
          settleWaiter(value);
        };
      const waiter: Waiter = { workerPath, options, limit, resolve: settle(resolve), reject: settle(reject), timer };
      this.queue.push(waiter);
    });

  /** what the pool is doing right now, for metrics */
  getStats = () => ({
    workers: this.getWorkerCount(),
    /** requests that are being handled by a worker */
    active: Array.from(this.leases.values()).reduce((result, current) => result + current.size, 0),
    /** requests that wait for a worker */
    waiting: this.queue.length,
    /** requests that were refused because too many waited, and requests that gave up after waiting too long, since the pool started */
    refused: { ...this.refused },
    /** requests that stopped waiting because their client went away, since the pool started */
    abandoned: this.abandoned,
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
   * When none could be started, as the overall limit is used up by other paths, the request waits in line. Rejects with a WorkerBusyError when too many wait already
   * or when it waited for the acquire timeout, and with a WorkerUnavailableError when the workers of the path keep crashing.
   * A request that waits leaves the line when the signal aborts, and rejects with a WorkerAbandonedError.
   */
  acquire = async (workerPath: string, options: SpawnOptions = {}, limit = 0, signal?: AbortSignal): Promise<WorkerLease> => {
    const worker = this.tryGetWorker(workerPath, options, limit);

    return worker === undefined ? this.enqueue(workerPath, options, limit, signal) : this.createLease(worker);
  };
}

export default WorkerPool;
