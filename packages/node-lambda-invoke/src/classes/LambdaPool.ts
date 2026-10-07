import uuid from 'uuid';
import Lambda from './Lambda';
import stdoutListener from '../middlewares/stdoutListener';
import { EVENT_STARTED } from '../constants';
import type { Communication, LambdaEvent, Logger } from '../types';

interface LambdaPoolOptions {
  /** how many lambdas may run in total, 0 or nothing for no limit */
  overallLimit?: number;
  /** how long a request may wait for a lambda when the limit is reached, in milliseconds */
  acquireTimeout?: number;
  logger?: Logger;
  communication: Communication;
}

/** the limit is reached and no lambda became free in time */
export class LambdaUnavailableError extends Error {}

const pollInterval = 5;

const lambdaInstances = new Map<string, Map<string, Lambda>>();

/** lambdas that were asked for but have not announced themselves yet, they count against the limit as well */
const starting = new Map<string, number>();

const getCount = (lambdaToInvoke: string) => (lambdaInstances.get(lambdaToInvoke)?.size ?? 0) + (starting.get(lambdaToInvoke) ?? 0);

function getOverallCount() {
  return Array.from(new Set([...lambdaInstances.keys(), ...starting.keys()])).reduce((result, current) => getCount(current) + result, 0);
}

function getNonBusyId(lambdaToInvoke: string) {
  const timeLimit = Date.now() - 15 * 60 * 1000 + 5000; // lifespan of lambda, to give enough time to respond before killed
  return Array.from(lambdaInstances.get(lambdaToInvoke)?.entries() ?? []).find(
    ([, instance]) => !instance.busy && instance.createdAt !== undefined && instance.createdAt >= timeLimit
  )?.[0];
}

/**
 * Makes room under the limit for the first lambda of a file, by stopping an idle lambda of the file that has the most.
 * Files are never left without a lambda this way, so one busy file cannot starve the others.
 */
function evictIdleLambda(excluded: string): boolean {
  const victim = Array.from(lambdaInstances.entries())
    .filter(([lambdaToInvoke, instances]) => lambdaToInvoke !== excluded && instances.size > 1)
    .sort(([, a], [, b]) => b.size - a.size)
    .flatMap(([, instances]) =>
      Array.from(instances.entries())
        .filter(([, instance]) => !instance.busy)
        .slice(0, 1)
        .map(([id, instance]) => ({ instances, id, instance }))
    )[0];

  if (victim === undefined) {
    return false;
  }

  // the close event is asynchronous, so the registry is updated right away to free the slot
  victim.instances.delete(victim.id);
  victim.instance.instance?.terminate();
  return true;
}

class LambdaPool {
  readonly communication: Communication;
  readonly overallLimit: number;
  readonly acquireTimeout: number;
  readonly logger: Logger;

  constructor({ overallLimit = 0, acquireTimeout = 10000, logger = () => {}, communication }: LambdaPoolOptions) {
    this.communication = communication;
    this.overallLimit = overallLimit;
    this.acquireTimeout = acquireTimeout;
    this.logger = logger;

    this.getLambda = this.getLambda.bind(this);
    this.createLambda = this.createLambda.bind(this);
  }

  createLambda(lambdaToInvoke: string, handlerKey: string) {
    return new Promise<{ id: string; instance: Lambda }>((resolve, reject) => {
      const currentId = uuid.v4();
      const currentLambdaInstance = new Lambda(lambdaToInvoke, handlerKey, this.logger, this.communication);
      // a lambda that cannot start answers nobody, so the request waiting for it has to fail instead of waiting forever
      const failedToStart = (reason: unknown) => reject(new Error(`Lambda ${lambdaToInvoke} did not start: ${reason}`));

      const lambdaStartListener = (message: LambdaEvent) => {
        if (message.type === EVENT_STARTED) {
          this.logger(`[${currentId}] started`);
          currentLambdaInstance.removeEventListener('message', lambdaStartListener);
          resolve({ id: currentId, instance: currentLambdaInstance });
        }
      };
      currentLambdaInstance.addEventListener('message', lambdaStartListener);

      currentLambdaInstance.addEventListenerOnce('error', failedToStart);
      currentLambdaInstance.addEventListenerOnce('close', (code: number | null) => {
        if (code) this.logger(`[${currentId}] Lambda exited with code ${code}`);
        failedToStart(`it exited with code ${code}`);
        // a lambda that is gone must not be handed out, nor count against the limit
        lambdaInstances.get(lambdaToInvoke)?.delete(currentId);
      });

      stdoutListener(currentLambdaInstance, this.logger);
    });
  }

  private async startLambda(lambdaToInvoke: string, handlerKey: string): Promise<Lambda> {
    starting.set(lambdaToInvoke, (starting.get(lambdaToInvoke) ?? 0) + 1);

    try {
      const { id, instance } = await this.createLambda(lambdaToInvoke, handlerKey);
      // taken by the request that asked for it, before anything else can pick it from the registry
      instance.busy = true;
      instance.createdAt = Date.now();
      const instances = lambdaInstances.get(lambdaToInvoke) ?? new Map<string, Lambda>();
      instances.set(id, instance);
      lambdaInstances.set(lambdaToInvoke, instances);

      return instance;
    } finally {
      starting.set(lambdaToInvoke, (starting.get(lambdaToInvoke) ?? 1) - 1);
    }
  }

  /**
   * Hands out a lambda for the file: a free one, otherwise a new one while the limit allows, otherwise the request waits for one to become free.
   * Rejects with a LambdaUnavailableError when that takes longer than the acquire timeout.
   */
  async getLambda(lambdaToInvoke: string, handlerKey: string): Promise<Lambda> {
    const deadline = Date.now() + this.acquireTimeout;

    for (;;) {
      const nonBusyId = getNonBusyId(lambdaToInvoke);

      const lambdaInstance = nonBusyId === undefined ? undefined : lambdaInstances.get(lambdaToInvoke)?.get(nonBusyId);

      if (lambdaInstance !== undefined) {
        // marked right away: the invocation starts later, and requests in between must not get the same lambda, as it answers one at a time
        lambdaInstance.busy = true;

        return lambdaInstance;
      }

      const hasRoom = this.overallLimit <= 0 || getOverallCount() < this.overallLimit;

      if (hasRoom || (getCount(lambdaToInvoke) === 0 && evictIdleLambda(lambdaToInvoke))) {
        return this.startLambda(lambdaToInvoke, handlerKey);
      }

      if (Date.now() >= deadline) {
        throw new LambdaUnavailableError(`No lambda became available for ${lambdaToInvoke} within ${this.acquireTimeout}ms.`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }
}

export default LambdaPool;
