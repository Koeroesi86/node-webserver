import { randomUUID } from 'node:crypto';
import type Worker from '@koeroesi86/node-worker';
import type { Channel } from './createChannel';
import { WorkerMinUptime, WorkerRestartBackoff } from '../constants';
import WorkerUnavailableError from './workerUnavailableError';
import createWorkerBudget from './create-worker-budget';
import createRestartBackoff from './create-restart-backoff';
import createWorkerEviction from './create-worker-eviction';
import createWorkerRegistry from './create-worker-registry';
import createWorkerLease from './create-worker-lease';
import createWorkerCloseSteps from './create-worker-close-steps';
import spawnWorker from './spawn-worker';
import watchWorkerUptime from './watch-worker-uptime';
import WorkerAcquisitionQueue from './worker-acquisition-queue';
import type { WorkerLease } from './create-worker-lease';
import type { CloseStep } from './create-worker-close-steps';
import type { SpawnOptions } from './spawn-worker';
import type { IdleWorker, WorkerBudget, WorkerBudgetMember, WorkerInputEvent } from '../types';

export type { WorkerLease } from './create-worker-lease';
export type { SpawnOptions } from './spawn-worker';

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

interface WorkerRequest {
  workerPath: string;
  options: SpawnOptions;
  limit: number;
}

class WorkerPool implements WorkerBudgetMember {
  protected readonly overallLimit: number;
  protected readonly acquireTimeout: number;
  protected readonly onExit: (code: number, workerPath: string, id: string) => void;
  private readonly registry = createWorkerRegistry<Worker, Channel<WorkerInputEvent>>();
  private readonly restartBackoff: ReturnType<typeof createRestartBackoff>;
  /** the workers that the pool stops itself, which is no crash */
  private readonly stopping: WeakSet<Worker>;
  private readonly onStdout?: (data: Buffer) => void;
  private readonly onStderr?: (data: Buffer) => void;
  private readonly minUptime: number;
  private readonly acquisitionQueue: WorkerAcquisitionQueue<WorkerRequest, WorkerLease>;
  private readonly idleTimeout: number;
  private readonly budget: WorkerBudget;
  private readonly eviction: ReturnType<typeof createWorkerEviction<Worker>>;
  private readonly closeSteps: CloseStep<Worker>[];
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
    budget,
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
    this.eviction = createWorkerEviction({
      getGroups: this.registry.getGroups,
      getEntry: this.registry.getEntry,
      getLoad: this.registry.getLoad,
      unlist: this.registry.unlist,
      stop: this.stop,
    });
    this.closeSteps = createWorkerCloseSteps({
      registry: this.registry,
      restartBackoff: this.restartBackoff,
      isStopping: (worker) => this.stopping.has(worker),
      onExit,
      wakeUp: this.wakeWaiting,
      checkDisposed: this.checkDisposed,
      refillWarmPaths: () => this.minimums.forEach((_, warmPath) => this.refill(warmPath)),
    });
    this.idleTimeout = idleTimeout;
    this.budget = budget ?? createWorkerBudget();
    this.budget.join(this);
    // a budget that was given is closed by whoever made it, for all its pools at once, not with a listener for each pool
    if (!budget) process.once('exit', this.onClose);
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
    this.registry.getWorkers().forEach(this.stop);
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
        process.off('exit', this.onClose);
        this.budget.leave(this);
        resolve();
      };
      this.stopIdleWorkers();
      this.checkDisposed();
    });

  private stopIdleWorkers = () =>
    this.registry
      .getWorkers()
      .filter((worker) => !this.stopping.has(worker) && this.getLoad(worker) === 0)
      .forEach(this.stop);

  private checkDisposed = () => {
    if (this.getWorkerCount() > 0) return;

    this.onDisposed?.();
    this.onDisposed = undefined;
  };

  getWorkerCountForPath = (workerPath: string) => this.registry.getWorkerCountForPath(workerPath);

  getWorkerCount = () => this.registry.getWorkerCount();

  private getLoad = (worker: Worker) => this.registry.getLoad(worker);

  private belowOverallLimit = () => this.overallLimit <= 0 || this.getWorkerCount() < this.overallLimit;

  private hasRoom = () => this.belowOverallLimit() && this.budget.hasRoom();

  /** the worker with the fewest running requests, the ones tied on load take turns */
  private pickLeastLoaded = (workerPath: string, candidates: Worker[]): Worker | undefined => {
    const lowest = Math.min(...candidates.map(this.getLoad));
    const tied = candidates.filter((worker) => this.getLoad(worker) === lowest);

    return tied[this.registry.nextCursor(workerPath) % tied.length];
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
    if (this.getLoad(worker) > 0 || this.registry.getEntry(worker) === undefined || this.stopping.has(worker)) return;

    // the workers a path is kept warm with stay, and are looked at again later as the path can have more workers by then
    const entry = this.registry.getEntry(worker);
    if (this.getWorkerCountForPath(entry.workerPath) <= (this.minimums.get(entry.workerPath)?.count ?? 0)) {
      entry.idleTimer?.refresh();
      return;
    }

    // no request waits for the slot: one that could use it would have taken this worker when it became idle
    this.eviction.evict(worker, 'idle');
  };

  private createWorker = (workerPath: string, options: SpawnOptions): Worker => {
    const id = randomUUID();
    const { instance, channel } = spawnWorker({
      workerPath,
      options,
      onMessage: (message) => this.registry.getSubscription(message.requestId)?.onMessage?.(message),
      onStdout: this.onStdout,
      onStderr: this.onStderr,
    });
    const entry = { workerPath, id, lastUsed: Date.now(), idleTimer: this.startIdleTimer(instance) };
    this.registry.add(instance, entry, channel);

    const uptime = watchWorkerUptime(this.minUptime, () => this.restartBackoff.clear(workerPath));
    instance.addEventListenerOnce('close', (code: number) => {
      const closed = { worker: instance, entry, code, uptime, leases: [] };
      this.closeSteps.forEach((step) => step(closed));
    });

    return instance;
  };

  /** a worker that gets no request at all is stopped as well */
  private startIdleTimer = (worker: Worker): NodeJS.Timeout | undefined => {
    if (this.idleTimeout <= 0) return undefined;

    const timer = setTimeout(() => this.onIdleTimeout(worker), this.idleTimeout);
    timer.unref();

    return timer;
  };

  private tryGetWorker = (workerPath: string, options: SpawnOptions, limit: number): Worker | undefined => {
    // a worker that is being stopped takes no more requests
    const candidates = this.registry.getWorkersForPath(workerPath).filter((worker) => worker.instance.exitCode === null && !this.stopping.has(worker));
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

  private createLease = (worker: Worker): WorkerLease =>
    createWorkerLease({
      worker,
      registry: this.registry,
      onReleased: () => {
        // a worker has room again, for the request that has waited longest, and an idle one can make room in the other pools of the budget
        this.wakeWaiting();
        // a pool that is disposed of keeps a worker only for as long as it has requests
        if (this.onDisposed) this.stopIdleWorkers();
      },
    });

  private serve = ({ workerPath, options, limit }: WorkerRequest) => {
    const worker = this.tryGetWorker(workerPath, options, limit);
    return worker === undefined ? undefined : this.createLease(worker);
  };

  /** looks at the requests that wait, in the order they came in, whenever a worker could have become available: a request that is finished, a worker that stopped or started */
  wakeUp = () => this.acquisitionQueue.wakeUp(this.serve);

  /** also the pools of the budget, as a room that opened can be the one a request of another pool waits for */
  private wakeWaiting = () => {
    this.wakeUp();
    this.budget.wakeUp(this);
  };

  /** what the pool is doing right now, for metrics */
  getStats = () => ({
    workers: this.getWorkerCount(),
    /** requests that are being handled by a worker */
    active: this.registry.getActive(),
    /** requests that wait for a worker */
    ...this.acquisitionQueue.getStats(),
    /** workers stopped as they had no request for the idle timeout, and ones stopped to make room for the first worker of another path, since the pool started */
    evicted: this.eviction.getStats(),
    /** the paths whose workers crashed in a row, with the number of crashes and the time until another one is started */
    failing: this.restartBackoff.getStats(),
    paths: this.registry.getPathStats(),
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
