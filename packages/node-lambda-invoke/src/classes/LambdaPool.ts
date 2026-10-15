import { randomUUID } from 'node:crypto';
import WaitingLine from '@koeroesi86/node-worker/dist/waiting-line';
import Lambda from './Lambda';
import stdoutListener from '../middlewares/stdoutListener';
import scheduleLambdaDrain from '../utils/schedule-lambda-drain';
import stopLambdaIfRetired from '../utils/stop-lambda-if-retired';
import { DEFAULT_START_TIMEOUT, DEFAULT_TIMEOUT, DRAIN_AFTER, EVENT_STARTED, STOP_GRACE } from '../constants';
import type { Communication, LambdaEvent, Logger } from '../types';

interface LambdaPoolOptions {
  lambdaPath: string;
  handlerKey: string;
  /** how many lambdas this pool may run, 0 or nothing for no limit */
  limit?: number;
  /** how long a request may wait for a lambda when the limit is reached, in milliseconds */
  acquireTimeout?: number;
  /** how long a lambda may take to start, in milliseconds */
  startTimeout?: number;
  /** how long a handler may take to answer, in milliseconds, a lambda is allowed to run that long past the time it is drained */
  timeout?: number;
  /** whether the lambdas can only write to their own folders */
  restrictFileSystem?: boolean;
  /** variables added to the environment of the lambdas */
  env?: Record<string, string>;
  logger?: Logger;
  communication: Communication;
}

/** the limit is reached and no lambda became free in time */
export class LambdaUnavailableError extends Error {}

/** the client went away while the request waited for a lambda */
export class LambdaRequestAbandonedError extends Error {}

/** every pool of the process, for the stats */
const pools = new Set<LambdaPool>();

/** what the lambdas are doing right now, for metrics */
export function getLambdaStats() {
  const all = Array.from(pools);

  return {
    lambdas: all.reduce((result, pool) => result + pool.count, 0),
    /** lambdas that were asked for and have not announced themselves yet */
    starting: all.reduce((result, pool) => result + pool.starting, 0),
    busy: all.reduce((result, pool) => result + pool.busy, 0),
    /** requests that wait for a lambda to become free */
    waiting: all.reduce((result, pool) => result + pool.waiting, 0),
    /** requests whose client went away while they waited, since the process started */
    abandoned: all.reduce((result, pool) => result + pool.abandoned, 0),
    // several servers, or handlers, can use the same file
    files: all
      .filter(({ started }) => started > 0)
      .reduce<Record<string, { lambdas: number; busy: number }>>((result, pool) => {
        const { lambdas = 0, busy = 0 } = result[pool.lambdaPath] ?? {};
        return { ...result, [pool.lambdaPath]: { lambdas: lambdas + pool.started, busy: busy + pool.busy } };
      }, {}),
  };
}

/** the lambdas of one handler of one file, under a limit of its own */
class LambdaPool {
  readonly lambdaPath: string;
  readonly handlerKey: string;
  readonly communication: Communication;
  readonly limit: number;
  readonly acquireTimeout: number;
  readonly startTimeout: number;
  readonly timeout: number;
  readonly restrictFileSystem: boolean;
  readonly env?: Record<string, string>;
  readonly logger: Logger;
  private readonly instances = new Map<string, Lambda>();
  /** the requests in line, they get a lambda, or the promise of one that is starting */
  private readonly line: WaitingLine<undefined, Lambda | Promise<Lambda>>;
  /** lambdas that were asked for but have not announced themselves yet, they count against the limit as well */
  private startingCount = 0;
  /** set once the server does not use the pool any more */
  private closed = false;

  constructor({
    lambdaPath,
    handlerKey,
    limit = 0,
    acquireTimeout = 10000,
    startTimeout = DEFAULT_START_TIMEOUT,
    timeout = DEFAULT_TIMEOUT,
    restrictFileSystem = true,
    env,
    logger = () => {},
    communication,
  }: LambdaPoolOptions) {
    this.lambdaPath = lambdaPath;
    this.handlerKey = handlerKey;
    this.communication = communication;
    this.limit = limit;
    this.acquireTimeout = acquireTimeout;
    this.startTimeout = startTimeout;
    this.timeout = timeout;
    this.restrictFileSystem = restrictFileSystem;
    this.env = env;
    this.logger = logger;

    this.line = new WaitingLine({
      acquireTimeout,
      maxQueue: 0,
      // the line has no size limit, the acquire timeout bounds the wait
      createFullError: () => new LambdaUnavailableError(`Too many requests wait for a lambda for ${lambdaPath}.`),
      createTimeoutError: () => new LambdaUnavailableError(`No lambda became available for ${lambdaPath} within ${acquireTimeout}ms.`),
      createAbandonedError: () => new LambdaRequestAbandonedError(`The request for ${lambdaPath} was abandoned.`),
    });
    pools.add(this);
  }

  get started() {
    return this.instances.size;
  }

  get starting() {
    return this.startingCount;
  }

  get count() {
    return this.instances.size + this.startingCount;
  }

  get busy() {
    return Array.from(this.instances.values()).filter(({ busy }) => busy).length;
  }

  get waiting() {
    return this.line.getStats().waiting;
  }

  get abandoned() {
    return this.line.getStats().abandoned;
  }

  private getNonBusy() {
    return Array.from(this.instances.values()).find((instance) => !instance.busy && !instance.retiring);
  }

  createLambda = () =>
    new Promise<{ id: string; instance: Lambda }>((resolve, reject) => {
      const currentId = randomUUID();
      const currentLambdaInstance = new Lambda(this.lambdaPath, this.handlerKey, this.logger, this.communication, this.env, {
        // the pool stops it when it is time, this is for when that does not work out
        maxLifetime: DRAIN_AFTER + this.timeout + STOP_GRACE,
        restrictFileSystem: this.restrictFileSystem,
      });
      // a lambda that cannot start answers nobody, so the request waiting for it has to fail instead of waiting forever
      const failedToStart = (reason: unknown) => {
        clearTimeout(startTimer);
        reject(new Error(`Lambda ${this.lambdaPath} did not start: ${reason}`));
      };
      // a module that hangs while it is loaded would keep its request and its place under the limit forever
      const startTimer = setTimeout(() => {
        failedToStart(`it took longer than ${this.startTimeout}ms`);
        currentLambdaInstance.terminate('SIGKILL');
      }, this.startTimeout);

      const lambdaStartListener = (message: LambdaEvent) => {
        if (message.type === EVENT_STARTED) {
          this.logger(`[${currentId}] started`);
          clearTimeout(startTimer);
          currentLambdaInstance.removeEventListener('message', lambdaStartListener);
          resolve({ id: currentId, instance: currentLambdaInstance });
        }
      };
      currentLambdaInstance.addEventListener('message', lambdaStartListener);

      currentLambdaInstance.addEventListenerOnce('error', failedToStart);
      currentLambdaInstance.addEventListenerOnce('close', (code: number | null) => failedToStart(`it exited with code ${code}`));

      stdoutListener(currentLambdaInstance, this.logger);
    });

  private async startLambda(): Promise<Lambda> {
    this.startingCount += 1;

    try {
      const { id, instance } = await this.createLambda();
      // taken by the request that asked for it, before anything else can pick it from the registry
      instance.busy = true;
      instance.createdAt = Date.now();
      // a request that still came to a closed pool gets a lambda of its own, which stops once it answered
      instance.retiring = this.closed;
      scheduleLambdaDrain(instance, id, this.logger);
      instance.onFree = () => {
        stopLambdaIfRetired(instance);
        this.drain();
      };
      this.instances.set(id, instance);
      instance.addEventListenerOnce('close', () => {
        // a lambda that is gone must not be handed out, nor count against the limit, and its place goes to the first request in line
        this.instances.delete(id);
        this.drain();
        this.forgetIfClosed();
      });

      return instance;
    } finally {
      this.startingCount -= 1;
      // a lambda that failed to start gives its place back
      this.drain();
      this.forgetIfClosed();
    }
  }

  /** stops the lambdas once they answered the requests they took, for a server that is not used any more */
  close() {
    this.closed = true;
    this.instances.forEach((instance) => {
      instance.retiring = true;
      stopLambdaIfRetired(instance);
    });
    this.forgetIfClosed();
  }

  /** a closed pool leaves the stats once its last lambda stopped */
  private forgetIfClosed() {
    if (this.closed && this.count === 0) pools.delete(this);
  }

  /** a free lambda, otherwise a new one while the limit allows, otherwise nothing */
  private serveNext() {
    const lambda = this.getNonBusy();

    if (lambda !== undefined) {
      // marked right away: the invocation starts later, and requests in between must not get the same lambda, as it answers one at a time
      lambda.busy = true;
      return lambda;
    }

    return this.limit <= 0 || this.count < this.limit ? this.startLambda() : undefined;
  }

  /** hands lambdas to the requests in line, the first one first, as long as there are free lambdas or room for new ones */
  private drain() {
    this.line.wakeUp(this.serveNext.bind(this));
  }

  /** gives a lambda back that was handed out, but not used */
  release(lambda: Lambda) {
    lambda.busy = false;
    this.drain();
  }

  /**
   * Hands out a lambda: a free one, otherwise a new one while the limit allows, otherwise the request waits in line for one to become free, without polling.
   * Rejects with a LambdaUnavailableError when that takes longer than the acquire timeout, and with a LambdaRequestAbandonedError when the signal is aborted.
   */
  getLambda = async (signal?: AbortSignal): Promise<Lambda> => {
    const lambda = this.line.enqueue(undefined, signal);
    this.drain();
    return lambda;
  };
}

export default LambdaPool;
