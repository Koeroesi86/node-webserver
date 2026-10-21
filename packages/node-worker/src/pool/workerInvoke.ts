import { InvokableWorker } from './types';
import startWorkerProcess from './utils/start-worker-process';

const workerPath = process.argv.pop();
if (workerPath === undefined) throw new Error('workerInvoke needs the path of a worker file');

startWorkerProcess(require(workerPath) as InvokableWorker);
