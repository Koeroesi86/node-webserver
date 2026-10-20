import { InvokableWorker } from './types';
import startWorkerProcess from './utils/start-worker-process';

startWorkerProcess(require(process.argv.pop()) as InvokableWorker);
