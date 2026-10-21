import { randomUUID } from 'node:crypto';
import type Worker from '../../index';
import type { Channel } from './createChannel';
import { WORKER_EVENT, WorkerMinUptime, WorkerRestartBackoff } from '../constants';
import WorkerUnavailableError from './workerUnavailableError';
import createWorkerBudget from './create-worker-budget';
import createWorkerCommand from './create-worker-command';
import createWorkerReadiness from './create-worker-readiness';
import WorkerStartError from './workerStartError';
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
import type { WorkerEntry } from './create-worker-registry';
import type { SpawnOptions } from './spawn-worker';
import type {
  IdleWorker,
  PreparedWorker,
  WorkerBudget,
  WorkerBudgetMember,
  WorkerInputEvent,
  WorkerOutputEvent,
  WorkerPoolParams,
  WorkerRequest,
} from '../types';

export type { WorkerLease } from './create-worker-lease';
export type { SpawnOptions } from './spawn-worker';

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
  private readonly createCommand: (workerPath: string) => string[];
  private readonly concurrency: number;
  private readonly startTimeout: number;
  private readonly maxAge: number;
  private readonly stopSignal: NodeJS.Signals;
  private readonly killAfter: number;
  private readonly prepareWorker?: (context: { workerPath: string; id: string }) => PreparedWorker;
  /** what a worker needs undone once it ended, see `PreparedWorker.onClose` */
  private readonly cleanups = new WeakMap<Worker, () => void>();
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
    createCommand = createWorkerCommand,
    concurrency = 0,
    startTimeout = 0,
    maxAge = 0,
    stopSignal = 'SIGINT',
    killAfter = 0,
    prepareWorker,
  }: WorkerPoolParams) {
    this.overallLimit = overallLimit;
    this.acquireTimeout = acquireTimeout;
    this.acquisitionQueue = new WorkerAcquisitionQueue(acquireTimeout, maxQueue);
    this.onExit = onExit;
    this.createCommand = createCommand;
    this.concurrency = concurrency;
    this.startTimeout = startTimeout;
    this.maxAge = maxAge;
    this.stopSignal = stopSignal;
    this.killAfter = killAfter;
    this.prepareWorker = prepareWorker;
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
      cleanUp: (worker) => this.cleanups.get(worker)?.(),
    });
    this.idleTimeout = idleTimeout;
    this.budget = budget ?? createWorkerBudget();
    this.budget.join(this);
    // a budget that was given is closed by whoever made it, for all its pools at once, not with a listener for each pool
    if (!budget) process.once('exit', this.onClose);
  }

  /** stops a worker, which is not a crash. One that is still there after `killAfter` is killed. */
  private stop = (worker: Worker) => {
    if (this.stopping.has(worker)) return;

    this.stopping.add(worker);
    if (this.killAfter > 0) {
      const killTimer = setTimeout(() => worker.terminate('SIGKILL'), this.killAfter);
      killTimer.unref();
      worker.addEventListenerOnce('close', () => clearTimeout(killTimer));
    }
    worker.terminate(this.stopSignal);
  };

  /** kills a worker whose request ran out of time, which is no crash of its path */
  private kill = (worker: Worker) => {
    this.stopping.add(worker);
    worker.terminate('SIGKILL');
  };

  /** a worker that reached its maximum age gets no more requests, and stops once it has none */
  private retire = (worker: Worker) => {
    const entry = this.registry.getEntry(worker);
    if (entry === undefined) return;

    entry.retired = true;
    this.stopIfRetired(worker);
  };

  private stopIfRetired = (worker: Worker) => {
    if (this.registry.getEntry(worker)?.retired && this.getLoad(worker) === 0) this.stop(worker);
  };

  /** the pool stops waiting for the worker: it is ready, or it will never be */
  private settleStart = (worker: Worker) => {
    const entry = this.registry.getEntry(worker);
    clearTimeout(entry?.startTimer);
    return entry?.readiness;
  };

  private markReady = (worker: Worker) => {
    const entry = this.registry.getEntry(worker);
    if (entry !== undefined) entry.ready = true;
    this.settleStart(worker)?.resolve();
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

  /** Stops the workers after their requests, or all of them after the timeout, and forgets the pool. Requests that still come are served first. */
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

  /** Stops an idle worker for the first worker of a path: of this pool at its own limit, of any pool of the budget otherwise. */
  private makeRoom = (): boolean => {
    const victim = this.belowOverallLimit() ? this.budget.findIdleWorker() : this.findIdleWorker();
    victim?.stop();

    return victim !== undefined && this.hasRoom();
  };

  private onIdleTimeout = (worker: Worker) => {
    // a worker that is busy again is timed anew when it finishes, one that is gone already has nothing to stop
    const entry = this.registry.getEntry(worker);
    if (entry === undefined || this.getLoad(worker) > 0 || this.stopping.has(worker)) return;

    // the workers a path is kept warm with stay, and are looked at again later as the path can have more workers by then
    if (this.getWorkerCountForPath(entry.workerPath) <= (this.minimums.get(entry.workerPath)?.count ?? 0)) {
      entry.idleTimer?.refresh();
      return;
    }

    // no request waits for the slot: one that could use it would have taken this worker when it became idle
    this.eviction.evict(worker, 'idle');
  };

  /** the messages of a worker: the ready signal belongs to the worker, all others to the request they carry */
  private receive = (worker: () => Worker | undefined) => (message: WorkerOutputEvent) => {
    if (message.type !== WORKER_EVENT.READY) {
      this.registry.getSubscription(message.requestId)?.onMessage?.(message);
      return;
    }

    const instance = worker();
    if (instance === undefined) return;

    this.markReady(instance);
    // a request that waits for a worker may use it now
    this.wakeWaiting();
  };

  /** the options of the request with the ones the pool prepared for this worker over them, `env` as a whole */
  private mergeOptions = (options: SpawnOptions, prepared: PreparedWorker): SpawnOptions =>
    prepared.options === undefined ? options : () => ({ ...(typeof options === 'function' ? options() : options), ...prepared.options });

  private createWorker = (workerPath: string, options: SpawnOptions): Worker => {
    const id = randomUUID();
    const prepared = this.prepareWorker?.({ workerPath, id }) ?? {};
    let created: Worker | undefined;
    let spawned: ReturnType<typeof spawnWorker>;
    try {
      spawned = spawnWorker({
        workerPath,
        command: this.createCommand(workerPath),
        options: this.mergeOptions(options, prepared),
        onMessage: this.receive(() => created),
        onStdout: this.onStdout,
        onStderr: this.onStderr,
      });
    } catch (error) {
      prepared.onClose?.();
      throw error;
    }
    const { instance, channel } = spawned;
    created = instance;
    const entry: WorkerEntry = {
      workerPath,
      id,
      lastUsed: Date.now(),
      idleTimer: this.startIdleTimer(instance),
      ageTimer: this.startAgeTimer(instance),
      readiness: this.startTimeout > 0 ? createWorkerReadiness() : undefined,
    };
    entry.startTimer = this.startStartTimer(instance, entry);
    this.registry.add(instance, entry, channel);
    if (prepared.onClose) this.cleanups.set(instance, prepared.onClose);

    const uptime = watchWorkerUptime(this.minUptime, () => this.restartBackoff.clear(workerPath));
    instance.addEventListenerOnce('close', (code: number) => {
      const closed = { worker: instance, entry, code, uptime, leases: [] };
      this.closeSteps.forEach((step) => step(closed));
    });

    return instance;
  };

  /** a worker that does not say it is ready is killed, which counts as a crash of its path */
  private startStartTimer = (worker: Worker, entry: WorkerEntry): NodeJS.Timeout | undefined => {
    if (entry.readiness === undefined) return undefined;

    const timer = setTimeout(() => {
      entry.readiness?.reject(new WorkerStartError(entry.workerPath, `it was not ready within ${this.startTimeout}ms`));
      worker.terminate('SIGKILL');
    }, this.startTimeout);
    timer.unref();

    return timer;
  };

  private startAgeTimer = (worker: Worker): NodeJS.Timeout | undefined => {
    if (this.maxAge <= 0) return undefined;

    const timer = setTimeout(() => this.retire(worker), this.maxAge);
    timer.unref();

    return timer;
  };

  /** a worker that gets no request at all is stopped as well */
  private startIdleTimer = (worker: Worker): NodeJS.Timeout | undefined => {
    if (this.idleTimeout <= 0) return undefined;

    const timer = setTimeout(() => this.onIdleTimeout(worker), this.idleTimeout);
    timer.unref();

    return timer;
  };

  private tryGetWorker = (workerPath: string, options: SpawnOptions, limit: number): Worker | undefined => {
    // a worker that is being stopped or retired takes no more requests
    const candidates = this.registry
      .getWorkersForPath(workerPath)
      .filter((worker) => worker.instance.exitCode === null && !this.stopping.has(worker) && !this.registry.getEntry(worker)?.retired);
    // one that is at its concurrency is full, the request waits for a place or for a new worker
    const open = candidates.filter((worker) => this.concurrency <= 0 || this.getLoad(worker) < this.concurrency);
    const leastLoaded = open.length > 0 ? this.pickLeastLoaded(workerPath, open) : undefined;

    if (leastLoaded !== undefined && this.getLoad(leastLoaded) === 0) {
      return leastLoaded;
    }

    // a crashing path gets no new worker for a while: busy ones take the request, without one it is refused. Workers at their concurrency are busy ones, the request waits for them.
    const backoff = this.restartBackoff.getBackoff(workerPath);
    if (backoff > 0 && candidates.length > 0) {
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

  private shouldWarm = (workerPath: string, count: number) =>
    !this.closed && this.getWorkerCountForPath(workerPath) < count && this.hasRoom() && this.restartBackoff.getBackoff(workerPath) === 0;

  /** Starts workers for the path ahead of its first request, so that one does not have to wait for a process to start. */
  warm = (workerPath: string, options: SpawnOptions = {}, count = 1) => {
    while (this.shouldWarm(workerPath, count)) {
      this.createWorker(workerPath, options);
    }
    this.wakeUp();
  };

  /** Like `warm`, and again whenever the path has fewer than `count`. Only takes room that no waiting request needs. */
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

    // retry once when the backoff is over, not on every worker that stops meanwhile
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
      onKill: this.kill,
      onReleased: () => {
        // a worker that grew old stops with its last request
        this.stopIfRetired(worker);
        // a worker has room again for the request that waited longest
        this.wakeWaiting();
        // a pool that is disposed of keeps a worker only for as long as it has requests
        if (this.onDisposed) this.stopIdleWorkers();
      },
    });

  private serve = ({ workerPath, options, limit }: WorkerRequest) => {
    const worker = this.tryGetWorker(workerPath, options, limit);
    return worker === undefined ? undefined : this.createLease(worker);
  };

  /** serves the waiting requests in order, whenever a worker may have become available */
  wakeUp = () => this.acquisitionQueue.wakeUp(this.serve);

  /** also the other pools of the budget, as the room can be what one of their requests waits for */
  private wakeWaiting = () => {
    this.wakeUp();
    this.budget.wakeUp(this);
  };

  /** what the pool is doing right now, for metrics */
  /** the numbers that change with every request, without the per path tables: cheap enough for a server that reads them for many pools */
  getCounts = () => ({
    workers: this.getWorkerCount(),
    /** workers that started but are not ready yet, only for a pool that waits for the handshake */
    starting: this.registry.getStarting(),
    /** requests that are being handled by a worker */
    active: this.registry.getActive(),
    /** requests that wait for a worker, and the ones that went away while they waited */
    ...this.acquisitionQueue.getStats(),
  });

  getStats = () => ({
    ...this.getCounts(),
    /** workers stopped when idle or to make room for another path, since the pool started */
    evicted: this.eviction.getStats(),
    /** paths whose workers crashed in a row, with the crashes and the time until the next start */
    failing: this.restartBackoff.getStats(),
    paths: this.registry.getPathStats(),
  });

  /**
   * Hands out an idle worker, else a new one below `limit` (0 or less keeps one), else the least busy; waits in line when the overall limit is used up.
   * Rejects with WorkerBusyError (line full or acquire timeout), WorkerUnavailableError (path keeps crashing) or WorkerAbandonedError (signal aborted).
   */
  acquire = async (workerPath: string, options: SpawnOptions = {}, limit = 0, signal?: AbortSignal): Promise<WorkerLease> => {
    const worker = this.tryGetWorker(workerPath, options, limit);

    return worker === undefined ? this.acquisitionQueue.enqueue({ workerPath, options, limit }, signal) : this.createLease(worker);
  };
}

export default WorkerPool;
