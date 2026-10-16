import { rm } from 'fs/promises';
import { resolve } from 'path';
import Worker from '../classes/Worker';
import createLambdaEnvironment from './create-lambda-environment';
import createLambdaFolder from './create-lambda-folder';
import createPermissionFlags from './create-permission-flags';
import trackLambdaFolder from './track-lambda-folder';
import type { Communication, Logger } from '../types';

export interface SpawnLambdaProcessOptions {
  lambdaPath: string;
  handlerKey: string;
  communication: Communication;
  env?: Record<string, string>;
  maxLifetime: number;
  restrictFileSystem: boolean;
  logger: Logger;
}

/** starts the process of a lambda in folders of its own, which are removed with it */
const spawnLambdaProcess = ({ lambdaPath, handlerKey, communication, env, maxLifetime, restrictFileSystem, logger }: SpawnLambdaProcessOptions) => {
  const folder = createLambdaFolder(communication.type === 'file');
  const untrackFolder = trackLambdaFolder(folder.root);
  const writableFolders = [folder.tmp, ...(folder.storage ? [folder.storage] : [])];
  const worker = new Worker(resolve(__dirname, '../middlewares/invoke.js'), {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: createLambdaEnvironment(lambdaPath, handlerKey, communication, env, {
      tmpFolder: folder.tmp,
      storageFolder: folder.storage,
      maxLifetime,
    }),
    execArgv: restrictFileSystem ? createPermissionFlags(writableFolders) : [],
  });
  // what the lambda wrote is gone with it, as the storage of an environment of AWS is
  worker.addEventListenerOnce('close', () => {
    untrackFolder();
    rm(folder.root, { recursive: true, force: true }).catch((error) => logger(error));
  });

  return { worker, storageFolder: folder.storage };
};

export default spawnLambdaProcess;
