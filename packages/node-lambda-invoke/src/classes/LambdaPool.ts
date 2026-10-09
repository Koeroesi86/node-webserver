import { randomUUID } from 'node:crypto';
import Lambda from './Lambda';
import stdoutListener from '../middlewares/stdoutListener';
import { DEFAULT_START_TIMEOUT, EVENT_STARTED } from '../constants';
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
  /** variables added to the environment of the lambdas */
  env?: Record<string, string>;
  logger?: Logger;
  communication: Communication;
}

/** the limit is reached and no lambda became free in time */
export class LambdaUnavailableError extends Error {}

const pollInterval = 5;

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
  readonly env?: Record<string, string>;
  readonly logger: Logger;
  private readonly instances = new Map<string, Lambda>();
  /** lambdas that were asked for but have not announced themselves yet, they count against the limit as well */
  starting = 0;

  constructor({
    lambdaPath,
    handlerKey,
    limit = 0,
    acquireTimeout = 10000,
    startTimeout = DEFAULT_START_TIMEOUT,
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
    this.env = env;
    this.logger = logger;

    this.getLambda = this.getLambda.bind(this);
    this.createLambda = this.createLambda.bind(this);
    pools.add(this);
  }

  get started() {
    return this.instances.size;
  }

  get count() {
    return this.instances.size + this.starting;
  }

  get busy() {
    return Array.from(this.instances.values()).filter(({ busy }) => busy).length;
  }

  private getNonBusy() {
    const timeLimit = Date.now() - 15 * 60 * 1000 + 5000; // lifespan of lambda, to give enough time to respond before killed
    return Array.from(this.instances.values()).find((instance) => !instance.busy && instance.createdAt !== undefined && instance.createdAt >= timeLimit);
  }

  createLambda() {
    return new Promise<{ id: string; instance: Lambda }>((resolve, reject) => {
      const currentId = randomUUID();
      const currentLambdaInstance = new Lambda(this.lambdaPath, this.handlerKey, this.logger, this.communication, this.env);
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
      currentLambdaInstance.addEventListenerOnce('close', (code: number | null) => {
        failedToStart(`it exited with code ${code}`);
        // a lambda that is gone must not be handed out, nor count against the limit
        this.instances.delete(currentId);
      });

      stdoutListener(currentLambdaInstance, this.logger);
    });
  }

  private async startLambda(): Promise<Lambda> {
    this.starting += 1;

    try {
      const { id, instance } = await this.createLambda();
      // taken by the request that asked for it, before anything else can pick it from the registry
      instance.busy = true;
      instance.createdAt = Date.now();
      this.instances.set(id, instance);

      return instance;
    } finally {
      this.starting -= 1;
    }
  }

  /**
   * Hands out a lambda: a free one, otherwise a new one while the limit allows, otherwise the request waits for one to become free.
   * Rejects with a LambdaUnavailableError when that takes longer than the acquire timeout.
   */
  async getLambda(): Promise<Lambda> {
    const deadline = Date.now() + this.acquireTimeout;

    for (;;) {
      const lambdaInstance = this.getNonBusy();

      if (lambdaInstance !== undefined) {
        // marked right away: the invocation starts later, and requests in between must not get the same lambda, as it answers one at a time
        lambdaInstance.busy = true;

        return lambdaInstance;
      }

      if (this.limit <= 0 || this.count < this.limit) {
        return this.startLambda();
      }

      if (Date.now() >= deadline) {
        throw new LambdaUnavailableError(`No lambda became available for ${this.lambdaPath} within ${this.acquireTimeout}ms.`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }
}

export default LambdaPool;
