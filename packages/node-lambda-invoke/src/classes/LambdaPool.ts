import uuid from 'uuid';
import Lambda from './Lambda';
import stdoutListener from '../middlewares/stdoutListener';
import { EVENT_STARTED } from '../constants';
import type { Communication, LambdaEvent, Logger } from '../types';

interface LambdaPoolOptions {
  overallLimit?: number;
  logger?: Logger;
  communication: Communication;
}

const lambdaInstances: Record<string, Record<string, Lambda>> = {};

function getOverallCount() {
  return Object.keys(lambdaInstances).reduce((result, current) => Object.keys(lambdaInstances[current]).length + result, 0);
}

function getNonBusyId(lambdaToInvoke: string) {
  const timeLimit = Date.now() - 15 * 60 * 1000 + 5000; // lifespan of lambda, to give enough time to respond before killed
  return Object.keys(lambdaInstances[lambdaToInvoke] || {}).find((id) => {
    const instance = lambdaInstances[lambdaToInvoke][id];
    return !instance.busy && instance.createdAt !== undefined && instance.createdAt >= timeLimit;
  });
}

class LambdaPool {
  readonly communication: Communication;
  readonly overallLimit?: number;
  readonly logger: Logger;

  constructor({ overallLimit, logger = () => {}, communication }: LambdaPoolOptions) {
    this.communication = communication;
    this.overallLimit = overallLimit;
    this.logger = logger;

    this.getLambda = this.getLambda.bind(this);
    this.createLambda = this.createLambda.bind(this);
  }

  createLambda(lambdaToInvoke: string, handlerKey: string) {
    return new Promise<{ id: string; instance: Lambda }>((resolve) => {
      const currentId = uuid.v4();
      const currentLambdaInstance = new Lambda(lambdaToInvoke, handlerKey, this.logger, this.communication);

      const lambdaStartListener = (message: LambdaEvent) => {
        if (message.type === EVENT_STARTED) {
          this.logger(`[${currentId}] started`);
          currentLambdaInstance.removeEventListener('message', lambdaStartListener);
          resolve({ id: currentId, instance: currentLambdaInstance });
        }
      };
      currentLambdaInstance.addEventListener('message', lambdaStartListener);

      currentLambdaInstance.addEventListenerOnce('close', (code: number | null) => {
        if (code) this.logger(`[${currentId}] Lambda exited with code ${code}`);
      });

      stdoutListener(currentLambdaInstance, this.logger);
    });
  }

  getLambda(lambdaToInvoke: string, handlerKey: string): Promise<Lambda> {
    const nonBusyId = getNonBusyId(lambdaToInvoke);

    if (this.overallLimit !== undefined && getOverallCount() >= this.overallLimit) {
      return Promise.resolve()
        .then(() => new Promise((r) => setTimeout(r, 100)))
        .then(() => this.getLambda(lambdaToInvoke, handlerKey));
    }

    if (!lambdaInstances[lambdaToInvoke] || !nonBusyId) {
      return Promise.resolve()
        .then(() => this.createLambda(lambdaToInvoke, handlerKey))
        .then(({ id, instance }) => {
          instance.createdAt = Date.now();
          lambdaInstances[lambdaToInvoke] = {
            ...lambdaInstances[lambdaToInvoke],
            [id]: instance,
          };

          return instance;
        });
    }

    return Promise.resolve(lambdaInstances[lambdaToInvoke][nonBusyId]);
  }
}

export default LambdaPool;
