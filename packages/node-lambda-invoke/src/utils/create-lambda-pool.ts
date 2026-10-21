import { rm } from 'fs/promises';
import { resolve } from 'path';
import { createWorkerBudget, WorkerPool } from '@koeroesi86/node-worker/pool';
import { DRAIN_AFTER, STOP_GRACE } from '../constants';
import type { Logger } from '../types';
import createLambdaEnvironment from './create-lambda-environment';
import createLambdaFolder from './create-lambda-folder';
import createPermissionFlags from './create-permission-flags';
import getDate from './get-date';
import trackLambdaFolder from './track-lambda-folder';

export interface LambdaPoolParams {
  lambdaPath: string;
  handlerKey: string;
  /** how many lambdas may run, 0 for no limit */
  limit: number;
  /** how long a request waits for a lambda when the limit is reached, in milliseconds */
  acquireTimeout: number;
  /** how long a lambda may take to load and say it is ready, in milliseconds */
  startTimeout: number;
  /** how long a handler may take to answer, in milliseconds, a lambda is allowed to run that long past the time it is drained */
  timeout: number;
  /** whether the lambdas can only write to their own folder */
  restrictFileSystem: boolean;
  env?: Record<string, string>;
  logger: Logger;
}

/** The pools do not limit each other: every lambda middleware has the limit of its own, so they share a budget without one. A lambda ends with the server anyway: it exits when its channel closes. */
const budget = createWorkerBudget();

/** the file that loads a lambda in its process, from src/ and from dist/ */
const runner = resolve(__dirname, '../middlewares/runner.js');

/**
 * The pool that runs the lambda of one file and handler: a lambda is a worker that answers one request at a time, with a folder of its own that goes with it,
 * is drained after a while and stopped when idle, and gets its signal, then its kill.
 */
const createLambdaPool = ({ lambdaPath, handlerKey, limit, acquireTimeout, startTimeout, timeout, restrictFileSystem, env, logger }: LambdaPoolParams) => {
  const log = (data: Buffer) => logger(`[${getDate()}] ${data.toString().trim()}`);

  return new WorkerPool({
    overallLimit: limit,
    acquireTimeout,
    // the line has no size limit, the acquire timeout bounds the wait
    maxQueue: 0,
    budget,
    concurrency: 1,
    startTimeout,
    maxAge: DRAIN_AFTER,
    stopSignal: 'SIGTERM',
    killAfter: STOP_GRACE,
    createCommand: () => [process.execPath, runner, lambdaPath],
    onStdout: log,
    onStderr: log,
    onExit: (code) => {
      if (code) logger(`[${getDate()}] child process exited with code ${code}`);
    },
    prepareWorker: () => {
      // what the lambda wrote is gone with it, as the storage of an environment of AWS is
      const folder = createLambdaFolder();
      const untrackFolder = trackLambdaFolder(folder.root);

      return {
        options: {
          // only what a lambda is allowed to know, not the environment of the server
          env: createLambdaEnvironment(lambdaPath, handlerKey, env, {
            tmpFolder: folder.tmp,
            // the pool stops it when it is time, this is for when that does not work out
            maxLifetime: DRAIN_AFTER + timeout + STOP_GRACE,
          }),
          execArgv: restrictFileSystem ? createPermissionFlags([folder.tmp]) : [],
        },
        onClose: () => {
          untrackFolder();
          rm(folder.root, { recursive: true, force: true }).catch((error) => logger(error));
        },
      };
    },
  });
};

export default createLambdaPool;
