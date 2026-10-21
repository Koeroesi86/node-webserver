import { randomUUID } from 'node:crypto';
import type Worker from '../../index';
import type { Channel } from './create-channel';
import { WORKER_EVENT, WorkerMinUptime, WorkerRestartBackoff } from '../constants';
import WorkerUnavailableError from './worker-unavailable-error';
import createWorkerBudget from './create-worker-budget';
import createWorkerCommand from './create-worker-command';
import createWorkerReadiness from './create-worker-readiness';
import createRestartBackoff from './create-restart-backoff';
import createWorkerEviction from './create-worker-eviction';
import createWorkerRegistry from './create-worker-registry';
import createWorkerLease from './create-worker-lease';
import createWorkerTimers from './create-worker-timers';
import createWorkerCloseSteps from './create-worker-close-steps';
import spawnWorker from './spawn-worker';
import startUnrefTimer from './start-unref-timer';
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
  /** what the pool was given and only passes on to its workers */
  private readonly settings: Pick<WorkerPoolParams, 'onStdout' | 'onStderr' | 'prepareWorker'> & {
    minUptime: number;
    stopSignal: NodeJS.Signals;
    killAfter: number;
    createCommand: (workerPath: string) => string[];
  };
  private readonly timers: ReturnType<typeof createWorkerTimers>;
  private readonly acquisitionQueue: WorkerAcquisitionQueue<WorkerRequest, WorkerLease>;
  private readonly budget: WorkerBudget;
  private readonly eviction: ReturnType<typeof createWorkerEviction<Worker>>;
  private readonly closeSteps: CloseStep<Worker>[];
  private readonly concurrency: number;
  private readonly startTimeout: number;
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
    this.settings = { onStdout, onStderr, prepareWorker, createCommand, stopSignal, killAfter, minUptime: restartBackoff.minUptime };
    this.concurrency = concurrency;
    this.startTimeout = startTimeout;
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
    this.timers = createWorkerTimers({ startTimeout, maxAge, idleTimeout, onAge: this.retire, onIdle: this.onIdleTimeout });
    this.budget = budget ?? createWorkerBudget();
    this.budget.join(this);
    // a budget that was given is closed by whoever made it, for all its pools at once, not with a listener for each pool
    if (!budget) process.once('exit', this.onClose);
  }

  /** stops a worker, which is not a crash. One that is still there after `killAfter` is killed. */
  private stop = (worker: Worker) => {
    if (this.stopping.has(worker)) return;

    this.stopping.add(worker);
    if (this.settings.killAfter > 0) {
      const killTimer = startUnrefTimer(() => worker.terminate('SIGKILL'), this.settings.killAfter);
      worker.addEventListenerOnce('close', () => clearTimeout(killTimer));
    }
    worker.terminate(this.settings.stopSignal);
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
      // the server may stop before, which stops the workers anyway
      const timer = startUnrefTimer(this.onClose, timeout);
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
  private receive = (message: WorkerOutputEvent, worker: Worker) => {
    if (message.type !== WORKER_EVENT.READY) {
      this.registry.getSubscription(message.requestId)?.onMessage?.(message);
      return;
    }

    this.markReady(worker);
    // a request that waits for a worker may use it now
    this.wakeWaiting();
  };

  /** the options of the request with the ones the pool prepared for this worker over them, `env` as a whole */
  private mergeOptions = (options: SpawnOptions, prepared: PreparedWorker): SpawnOptions =>
    prepared.options === undefined ? options : () => ({ ...(typeof options === 'function' ? options() : options), ...prepared.options });

  private createWorker = (workerPath: string, options: SpawnOptions): Worker => {
    const id = randomUUID();
    const prepared = this.settings.prepareWorker?.({ workerPath, id }) ?? {};
    const { instance, channel } = this.spawn(workerPath, this.mergeOptions(options, prepared), prepared);
    const entry = this.createEntry(instance, workerPath, id);
    this.registry.add(instance, entry, channel);
    if (prepared.onClose) this.cleanups.set(instance, prepared.onClose);
    this.watchClose(instance, entry);

    return instance;
  };

  /** a worker that could not be started has nothing to undo later, so what was prepared for it is undone at once */
  private spawn = (workerPath: string, options: SpawnOptions, prepared: PreparedWorker) => {
    try {
      return spawnWorker({
        workerPath,
        command: this.settings.createCommand(workerPath),
        options,
        onMessage: this.receive,
        onStdout: this.settings.onStdout,
        onStderr: this.settings.onStderr,
      });
    } catch (error) {
      prepared.onClose?.();
      throw error;
    }
  };

  private createEntry = (worker: Worker, workerPath: string, id: string): WorkerEntry => {
    const entry: WorkerEntry = {
      workerPath,
      id,
      lastUsed: Date.now(),
      idleTimer: this.timers.idle(worker),
      ageTimer: this.timers.age(worker),
      readiness: this.startTimeout > 0 ? createWorkerReadiness() : undefined,
    };
    entry.startTimer = this.timers.start(worker, entry);

    return entry;
  };

  /** a worker that ends goes through the close steps, and counts as stable once it ran for the minimum uptime */
  private watchClose = (worker: Worker, entry: WorkerEntry) => {
    const uptime = watchWorkerUptime(this.settings.minUptime, () => this.restartBackoff.clear(entry.workerPath));
    worker.addEventListenerOnce('close', (code: number) => {
      const closed = { worker, entry, code, uptime, leases: [] };
      this.closeSteps.forEach((step) => step(closed));
    });
  };

  /** the workers of a path that take requests: one that is being stopped or retired takes no more */
  private findAvailableWorkers = (workerPath: string) =>
    this.registry
      .getWorkersForPath(workerPath)
      .filter((worker) => worker.instance.exitCode === null && !this.stopping.has(worker) && !this.registry.getEntry(worker)?.retired);

  /** the least loaded worker with a place left: one that is at its concurrency is full, the request waits for a place or for a new worker */
  private findOpenWorker = (workerPath: string, available: Worker[]) => {
    const open = available.filter((worker) => this.concurrency <= 0 || this.getLoad(worker) < this.concurrency);

    return open.length > 0 ? this.pickLeastLoaded(workerPath, open) : undefined;
  };

  /** another worker is only started when all the running ones are busy, and there is room for it */
  private canStartWorker = (running: number, limit: number) => running < Math.max(limit, 1) && (this.hasRoom() || (running === 0 && this.makeRoom()));

  private tryGetWorker = (workerPath: string, options: SpawnOptions, limit: number): Worker | undefined => {
    const available = this.findAvailableWorkers(workerPath);
    const leastLoaded = this.findOpenWorker(workerPath, available);

    if (leastLoaded !== undefined && this.getLoad(leastLoaded) === 0) return leastLoaded;

    // a crashing path gets no new worker for a while: busy ones take the request, without one it is refused. Workers at their concurrency are busy ones, the request waits for them.
    const backoff = this.restartBackoff.getBackoff(workerPath);
    if (backoff > 0 && available.length > 0) return leastLoaded;
    if (backoff > 0) throw new WorkerUnavailableError(workerPath, backoff);

    return this.canStartWorker(available.length, limit) ? this.createWorker(workerPath, options) : leastLoaded;
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
    const timer = startUnrefTimer(() => {
      this.refillTimers.delete(workerPath);
      this.refill(workerPath);
    }, backoff);
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
