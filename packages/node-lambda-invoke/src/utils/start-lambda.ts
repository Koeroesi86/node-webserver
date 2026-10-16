import Lambda from '../classes/Lambda';
import stdoutListener from '../middlewares/stdoutListener';
import { getRegisteredPath } from '../registry';
import spawnLambdaProcess from './spawn-lambda-process';
import type { SpawnLambdaProcessOptions } from './spawn-lambda-process';
import { EVENT_STARTED } from '../constants';
import type { LambdaEvent, StorageDriverConstructor } from '../types';

export interface StartLambdaOptions extends SpawnLambdaProcessOptions {
  /** for the log lines */
  id: string;
  /** how long the lambda may take to announce itself, in milliseconds */
  startTimeout: number;
}

/** starts a lambda and settles once it announced itself, or fails when it cannot: a request waiting for it must not wait forever */
const startLambda = (options: StartLambdaOptions) =>
  new Promise<Lambda>((resolve, reject) => {
    const { id, lambdaPath, startTimeout, communication, logger } = options;
    const StorageDriver: StorageDriverConstructor = require(getRegisteredPath(communication.type));
    const { worker, storageFolder } = spawnLambdaProcess(options);
    const lambda = new Lambda(worker, { StorageDriver, storageFolder, logger });

    const failedToStart = (reason: unknown) => {
      clearTimeout(startTimer);
      reject(new Error(`Lambda ${lambdaPath} did not start: ${reason}`));
    };
    // a module that hangs while it is loaded would keep its request and its place under the limit forever
    const startTimer = setTimeout(() => {
      failedToStart(`it took longer than ${startTimeout}ms`);
      lambda.terminate('SIGKILL');
    }, startTimeout);

    const startListener = (message: LambdaEvent) => {
      if (message.type !== EVENT_STARTED) return;

      logger(`[${id}] started`);
      clearTimeout(startTimer);
      lambda.removeEventListener('message', startListener);
      resolve(lambda);
    };
    lambda.addEventListener('message', startListener);
    lambda.addEventListenerOnce('error', failedToStart);
    lambda.addEventListenerOnce('close', (code: number | null) => failedToStart(`it exited with code ${code}`));

    stdoutListener(lambda, logger);
  });

export default startLambda;
