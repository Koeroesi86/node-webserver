import { randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import path from 'path';
import { Duplex } from 'stream';
import Worker from '@koeroesi86/node-worker';
import createChannel from './createChannel';
import type { Channel } from './createChannel';
import { WorkerMinUptime, WorkerRestartBackoff } from '../constants';
import WorkerUnavailableError from './workerUnavailableError';
import createWorkerBudget from './create-worker-budget';
import createRestartBackoff from './create-restart-backoff';
import createWorkerEviction from './create-worker-eviction';
import WorkerAcquisitionQueue from './worker-acquisition-queue';
import type { HandOffMessage, IdleWorker, WorkerBudget, WorkerBudgetMember, WorkerInputEvent, WorkerOutputEvent } from '../types';

const pools: WorkerPool[] = [];

process.once('exit', () => {
  pools.forEach((pool) => pool.onClose());
});

const createWorkerCommand = (workerPath) => {
  const ext = path.extname(workerPath);
  switch (ext) {
    case '.js':
    default:
      return `node --expose-gc ${path.resolve(__dirname, '../workerInvoke.js')} ${workerPath}`;
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
  /** a worker that has not had a request for this long is stopped, in milliseconds. 0 keeps idle workers running. */
  idleTimeout?: number;
  /** a limit shared with other pools, on top of `overallLimit` */
  budget?: WorkerBudget;
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
  /**
   * gives the connection of the client to the worker, along with the message, over the IPC channel. The socket is closed in this process once it was sent,
   * the promise rejects when it could not be sent
   */
  handOff: (message: HandOffMessage, socket: Socket) => Promise<void>;
  /** frees the worker for other requests, safe to call more than once */
  release: () => void;
}

interface WorkerRequest {
  workerPath: string;
  options: SpawnOptions;
  limit: number;
}

/** what the pool knows about a worker besides its requests */
interface WorkerEntry {
  workerPath: string;
  id: string;
  lastUsed: number;
  /** restarted whenever the worker finishes its last request, it stops the worker when it fires */
  idleTimer?: NodeJS.Timeout;
}

interface LeaseState {
  requestId?: string;
  onMessage?: (message: WorkerOutputEvent) => void;
  onExit?: (code: number | null) => void;
}

class WorkerPool implements WorkerBudgetMember {
  protected readonly overallLimit: number;
  protected readonly acquireTimeout: number;
  protected readonly onExit: (code: number, workerPath: string, id: string) => void;
  protected readonly workers: Map<string, Map<string, Worker>>;
  private readonly leases: Map<Worker, Set<LeaseState>>;
  private readonly channels: Map<Worker, Channel<WorkerInputEvent>>;
  private readonly subscriptions: Map<string, LeaseState>;
  private readonly cursors: Map<string, number>;
  private readonly restartBackoff: ReturnType<typeof createRestartBackoff>;
  /** the workers that the pool stops itself, which is no crash */
  private readonly stopping: WeakSet<Worker>;
  private readonly onStdout?: (data: Buffer) => void;
  private readonly onStderr?: (data: Buffer) => void;
  private readonly minUptime: number;
  private readonly acquisitionQueue: WorkerAcquisitionQueue<WorkerRequest, WorkerLease>;
  private readonly idleTimeout: number;
  private readonly budget: WorkerBudget;
  private readonly entries: Map<Worker, WorkerEntry> = new Map();
  private readonly eviction: ReturnType<typeof createWorkerEviction<Worker>>;
  /** the paths that keep a number of workers running, see `keepWarm` */
  private readonly minimums = new Map<string, { options: SpawnOptions; count: number }>();
  /** a path that is held back after crashes is warmed again when it may be, one timer per path */
  private readonly refillTimers = new Map<string, NodeJS.Timeout>();
  /** no worker is started after the pool was closed, as the process is on its way out */
  private closed = false;

  constructor({
    overallLimit = 0,
    acquireTimeout = 10000,
    maxQueue = 0,
    onExit = () => {},
    onStdout,
    onStderr,
    restartBackoff = { minUptime: WorkerMinUptime, ...WorkerRestartBackoff },
    idleTimeout = 0,
    budget = createWorkerBudget(),
  }: WorkerPoolParams) {
    this.overallLimit = overallLimit;
    this.acquireTimeout = acquireTimeout;
    this.acquisitionQueue = new WorkerAcquisitionQueue(acquireTimeout, maxQueue);
    this.onExit = onExit;
    this.onStdout = onStdout;
    this.onStderr = onStderr;
    this.minUptime = restartBackoff.minUptime;
    this.restartBackoff = createRestartBackoff(restartBackoff);
    this.stopping = new WeakSet();
    this.workers = new Map();
    this.leases = new Map();
    this.channels = new Map();
    this.subscriptions = new Map();
    this.cursors = new Map();
    this.eviction = createWorkerEviction({
      workers: this.workers,
      getEntry: (worker) => this.entries.get(worker),
      getLoad: this.getLoad,
      forgetPath: this.forgetPath,
      stop: this.stop,
    });
    this.idleTimeout = idleTimeout;
    this.budget = budget;
    budget.join(this);
    pools.push(this);
  }

  /** stops a worker, which is not a crash */
  private stop = (worker: Worker) => {
    this.stopping.add(worker);
    worker.terminate();
  };

  /** forgets the paths that are kept warm, the workers that run stay until they are stopped */
  private stopKeepingWarm = () => {
    this.minimums.clear();
    this.refillTimers.forEach((timer) => clearTimeout(timer));
    this.refillTimers.clear();
  };

  onClose = () => {
    this.closed = true;
    this.stopKeepingWarm();
    this.workers.forEach((current) => current.forEach(this.stop));
  };

  /** set while the pool is disposed of, called once its last worker stopped */
  private onDisposed?: () => void;

  /**
   * Stops the workers once they have answered the requests they took, or all of them after the timeout, and forgets the pool, for a server that is not used any more.
   * Requests that still come are served, by a worker that is stopped after them. Resolves once the workers stopped.
   */
  dispose = (timeout = 0) =>
    new Promise<void>((resolve) => {
      this.stopKeepingWarm();
      const timer = setTimeout(this.onClose, timeout);
      // the server may stop before, which stops the workers anyway
      timer.unref();
      this.onDisposed = () => {
        clearTimeout(timer);
        pools.splice(pools.indexOf(this), 1);
        this.budget.leave(this);
        resolve();
      };
      this.stopIdleWorkers();
      this.checkDisposed();
    });

  private stopIdleWorkers = () =>
    this.workers.forEach((current) => current.forEach((worker) => !this.stopping.has(worker) && this.getLoad(worker) === 0 && this.stop(worker)));

  private checkDisposed = () => {
    if (this.getWorkerCount() > 0) return;

    this.onDisposed?.();
    this.onDisposed = undefined;
  };

  getWorkerCountForPath = (p) => {
    return this.workers.get(p)?.size ?? 0;
  };

  getWorkerCount = () => {
    return Array.from(this.workers.values()).reduce((result, current) => current.size + result, 0);
  };

  private getLoad = (worker: Worker) => this.leases.get(worker)?.size ?? 0;

  private belowOverallLimit = () => this.overallLimit <= 0 || this.getWorkerCount() < this.overallLimit;

  private hasRoom = () => this.belowOverallLimit() && this.budget.hasRoom();

  /** the worker with the fewest running requests, the ones tied on load take turns */
  private pickLeastLoaded = (workerPath: string, candidates: Worker[]): Worker | undefined => {
    const lowest = Math.min(...candidates.map(this.getLoad));
    const tied = candidates.filter((worker) => this.getLoad(worker) === lowest);
    const cursor = this.cursors.get(workerPath) ?? 0;
    this.cursors.set(workerPath, cursor + 1);

    return tied[cursor % tied.length];
  };

  /** a path without workers keeps no state, so that many paths that were asked for once do not add up */
  private forgetPath = (workerPath: string) => {
    this.workers.delete(workerPath);
    this.cursors.delete(workerPath);
  };

  findIdleWorker = (): IdleWorker | undefined => this.eviction.findIdleWorker();

  /** Makes room for the first worker of a path by stopping an idle worker: of this pool when its own limit is used up, of any pool of the budget otherwise. */
  private makeRoom = (): boolean => {
    const victim = this.belowOverallLimit() ? this.budget.findIdleWorker() : this.findIdleWorker();
    victim?.stop();

    return victim !== undefined && this.hasRoom();
  };

  private onIdleTimeout = (worker: Worker) => {
    // a worker that is busy again is timed anew when it finishes, one that is gone already has nothing to stop
    if (this.getLoad(worker) > 0 || !this.entries.has(worker) || this.stopping.has(worker)) return;

    // the workers a path is kept warm with stay, and are looked at again later as the path can have more workers by then
    const entry = this.entries.get(worker);
    if (this.getWorkerCountForPath(entry.workerPath) <= (this.minimums.get(entry.workerPath)?.count ?? 0)) {
      entry.idleTimer?.refresh();
      return;
    }

    // no request waits for the slot: one that could use it would have taken this worker when it became idle
    this.eviction.evict(worker, 'idle');
  };

  private createWorker = (workerPath: string, options: SpawnOptions): Worker => {
    const id = randomUUID();
    // the IPC channel of node is only there for what the socket pair cannot carry: the connections of clients that are handed over.
    // the fourth stdio is the socket pair the messages go through, in place of the IPC channel of node that sends JSON.
    // 'overlapped' is a plain pipe except on Windows, where the worker could not read and write it at the same time otherwise
    const instance = new Worker(createWorkerCommand(workerPath), {
      ...(typeof options === 'function' ? options() : options),
      stdio: ['pipe', 'pipe', 'pipe', 'overlapped', 'ipc'],
    });
    const socket = instance.instance.stdio[3];
    if (!(socket instanceof Duplex)) {
      instance.terminate();
      throw new Error(`The worker ${workerPath} has no channel.`);
    }
    const workersForPath = this.workers.get(workerPath) ?? new Map<string, Worker>();
    this.workers.set(workerPath, workersForPath);
    this.leases.set(instance, new Set());
    const entry: WorkerEntry = { workerPath, id, lastUsed: Date.now() };
    if (this.idleTimeout > 0) {
      // a worker that gets no request at all is stopped as well
      entry.idleTimer = setTimeout(() => this.onIdleTimeout(instance), this.idleTimeout);
      entry.idleTimer.unref();
    }
    this.entries.set(instance, entry);

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
      this.restartBackoff.clear(workerPath);
    }, this.minUptime);
    stableTimer.unref();

    instance.addEventListenerOnce('close', (code: number) => {
      clearTimeout(stableTimer);
      clearTimeout(entry.idleTimer);
      if (!this.stopping.has(instance) && (!stable || code)) {
        this.restartBackoff.recordFailure(workerPath);
      }
      const states = Array.from(this.leases.get(instance) ?? []);
      workersForPath.delete(id);
      if (workersForPath.size === 0 && this.workers.get(workerPath) === workersForPath) this.forgetPath(workerPath);
      this.leases.delete(instance);
      this.channels.delete(instance);
      this.entries.delete(instance);
      states.forEach((state) => {
        this.subscriptions.delete(state.requestId);
        state.onExit?.(code);
      });
      this.onExit(code, workerPath, id);
      // there is room for another worker now, and the requests that wait may get one, also in the other pools of the budget
      this.wakeUp();
      this.budget.wakeUp(this);
      this.checkDisposed();
      // the requests that waited came first, also those of the other pools of the budget, the paths that are kept warm take what room is left, which can be the room of another path.
      // a worker that the pool stopped itself is not replaced: it made room for another worker, or the pool is going away
      if (!this.stopping.has(instance)) this.minimums.forEach((_, warmPath) => this.refill(warmPath));
    });

    workersForPath.set(id, instance);

    return instance;
  };

  private tryGetWorker = (workerPath: string, options: SpawnOptions, limit: number): Worker | undefined => {
    // a worker that is being stopped takes no more requests
    const candidates = Array.from(this.workers.get(workerPath)?.values() ?? []).filter(
      (worker) => worker.instance.exitCode === null && !this.stopping.has(worker)
    );
    const leastLoaded = candidates.length > 0 ? this.pickLeastLoaded(workerPath, candidates) : undefined;

    if (leastLoaded !== undefined && this.getLoad(leastLoaded) === 0) {
      return leastLoaded;
    }

    // a path whose workers keep crashing gets no new one for a while: the busy ones that still run take the request, and without one it is refused
    const backoff = this.restartBackoff.getBackoff(workerPath);
    if (backoff > 0 && leastLoaded !== undefined) {
      return leastLoaded;
    }
    if (backoff > 0) {
      throw new WorkerUnavailableError(workerPath, backoff);
    }

    // another worker is only started when all the running ones are busy
    const belowPathLimit = candidates.length < Math.max(limit, 1);
    const hasRoom = this.hasRoom() || (candidates.length === 0 && this.makeRoom());

    return belowPathLimit && hasRoom ? this.createWorker(workerPath, options) : leastLoaded;
  };

  /** Starts workers for the path ahead of its first request, so that one does not have to wait for a process to start. */
  warm = (workerPath: string, options: SpawnOptions = {}, count = 1) => {
    while (!this.closed && this.getWorkerCountForPath(workerPath) < count && this.hasRoom() && this.restartBackoff.getBackoff(workerPath) === 0) {
      this.createWorker(workerPath, options);
    }
    this.wakeUp();
  };

  /**
   * Like `warm`, and starts workers again whenever the path has fewer than `count`: after one stopped itself when it was idle, crashed, or was stopped to make room for another path.
   * The overall limit still holds and requests that wait for a worker come first, so the workers kept warm only take room that nothing else needs.
   */
  keepWarm = (workerPath: string, options: SpawnOptions = {}, count = 1) => {
    this.minimums.set(workerPath, { options, count });
    this.refill(workerPath);
  };

  private refill = (workerPath: string) => {
    const minimum = this.minimums.get(workerPath);
    if (minimum === undefined || this.closed || this.onDisposed !== undefined || this.refillTimers.has(workerPath)) return;

    const backoff = this.restartBackoff.getBackoff(workerPath);
    if (backoff === 0) {
      this.warm(workerPath, minimum.options, minimum.count);
      return;
    }

    // a path whose workers keep crashing is tried again when the backoff is over, not by every worker that stops in the meantime
    const timer = setTimeout(() => {
      this.refillTimers.delete(workerPath);
      this.refill(workerPath);
    }, backoff);
    timer.unref();
    this.refillTimers.set(workerPath, timer);
  };

  /** counts the request as a load of the worker right away, before anything else can look at the worker */
  private createLease = (leased: Worker): WorkerLease => {
    const state: LeaseState = {};
    this.leases.get(leased).add(state);

    return {
      worker: leased,
      send: (message) => this.channels.get(leased)?.send(message),
      handOff: (message, socket) =>
        new Promise<void>((resolve, reject) => {
          if (!leased.instance.connected) {
            reject(new Error('The worker has no IPC channel.'));
            return;
          }
          leased.instance.send(message, socket, (error) => (error ? reject(error) : resolve()));
        }),
      subscribe: (requestId, onMessage, onExit) => {
        Object.assign(state, { requestId, onMessage, onExit });
        this.subscriptions.set(requestId, state);
      },
      release: () => {
        this.leases.get(leased)?.delete(state);
        if (state.requestId !== undefined && this.subscriptions.get(state.requestId) === state) {
          this.subscriptions.delete(state.requestId);
        }
        const entry = this.entries.get(leased);
        if (entry !== undefined && this.getLoad(leased) === 0) {
          entry.lastUsed = Date.now();
          entry.idleTimer?.refresh();
        }
        // a worker has room again, for the request that has waited longest, and an idle one can make room in the other pools of the budget
        this.wakeUp();
        this.budget.wakeUp(this);
        // a pool that is disposed of keeps a worker only for as long as it has requests
        if (this.onDisposed) this.stopIdleWorkers();
      },
    };
  };

  private serve = ({ workerPath, options, limit }: WorkerRequest) => {
    const worker = this.tryGetWorker(workerPath, options, limit);
    return worker === undefined ? undefined : this.createLease(worker);
  };

  /** looks at the requests that wait, in the order they came in, whenever a worker could have become available: a request that is finished, a worker that stopped or started */
  wakeUp = () => this.acquisitionQueue.wakeUp(this.serve);

  /** what the pool is doing right now, for metrics */
  getStats = () => ({
    workers: this.getWorkerCount(),
    /** requests that are being handled by a worker */
    active: Array.from(this.leases.values()).reduce((result, current) => result + current.size, 0),
    /** requests that wait for a worker */
    ...this.acquisitionQueue.getStats(),
    /** workers stopped as they had no request for the idle timeout, and ones stopped to make room for the first worker of another path, since the pool started */
    evicted: this.eviction.getStats(),
    /** the paths whose workers crashed in a row, with the number of crashes and the time until another one is started */
    failing: this.restartBackoff.getStats(),
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

    return worker === undefined ? this.acquisitionQueue.enqueue({ workerPath, options, limit }, signal) : this.createLease(worker);
  };
}

export default WorkerPool;
