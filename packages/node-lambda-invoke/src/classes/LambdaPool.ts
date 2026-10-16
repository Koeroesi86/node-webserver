import { randomUUID } from 'node:crypto';
import { WaitingLine } from '@koeroesi86/node-worker';
import type Lambda from './Lambda';
import LambdaRequestAbandonedError from './LambdaRequestAbandonedError';
import LambdaUnavailableError from './LambdaUnavailableError';
import createLambdaStats from '../utils/create-lambda-stats';
import scheduleLambdaDrain from '../utils/schedule-lambda-drain';
import startLambda from '../utils/start-lambda';
import stopLambdaIfRetired from '../utils/stop-lambda-if-retired';
import { DEFAULT_START_TIMEOUT, DEFAULT_TIMEOUT, DRAIN_AFTER, STOP_GRACE } from '../constants';
import type { Communication, LambdaPoolOptions, LambdaStats, Logger } from '../types';

/** the stats of the pools made without a registry of their own, which `getLambdaStats` reads */
const defaultStats = createLambdaStats();

/** what the lambdas of the pools that were not given a registry are doing right now. Prefer `createLambdaStats` for a server of its own. */
export const getLambdaStats = defaultStats.getStats;

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
  private readonly stats: LambdaStats;
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
    stats = defaultStats,
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
    this.stats = stats;

    this.line = new WaitingLine({
      acquireTimeout,
      maxQueue: 0,
      // the line has no size limit, the acquire timeout bounds the wait
      createFullError: () => new LambdaUnavailableError(`Too many requests wait for a lambda for ${lambdaPath}.`),
      createTimeoutError: () => new LambdaUnavailableError(`No lambda became available for ${lambdaPath} within ${acquireTimeout}ms.`),
      createAbandonedError: () => new LambdaRequestAbandonedError(`The request for ${lambdaPath} was abandoned.`),
    });
    stats.add(this);
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

  private async startLambda(): Promise<Lambda> {
    this.startingCount += 1;

    try {
      const id = randomUUID();
      const instance = await startLambda({
        id,
        lambdaPath: this.lambdaPath,
        handlerKey: this.handlerKey,
        communication: this.communication,
        env: this.env,
        logger: this.logger,
        startTimeout: this.startTimeout,
        // the pool stops it when it is time, this is for when that does not work out
        maxLifetime: DRAIN_AFTER + this.timeout + STOP_GRACE,
        restrictFileSystem: this.restrictFileSystem,
      });
      // taken by the request that asked for it, before anything else can pick it from the registry
      instance.reserve();
      // a request that still came to a closed pool gets a lambda of its own, which stops once it answered
      if (this.closed) instance.retire();
      scheduleLambdaDrain(instance, id, this.logger);
      instance.onFree(() => {
        stopLambdaIfRetired(instance);
        this.drain();
      });
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
      instance.retire();
      stopLambdaIfRetired(instance);
    });
    this.forgetIfClosed();
  }

  /** a closed pool leaves the stats once its last lambda stopped */
  private forgetIfClosed() {
    if (this.closed && this.count === 0) this.stats.remove(this);
  }

  /** a free lambda, otherwise a new one while the limit allows, otherwise nothing */
  private serveNext() {
    const lambda = this.getNonBusy();

    if (lambda !== undefined) {
      // marked right away: the invocation starts later, and requests in between must not get the same lambda, as it answers one at a time
      lambda.reserve();
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
    lambda.markFree();
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
