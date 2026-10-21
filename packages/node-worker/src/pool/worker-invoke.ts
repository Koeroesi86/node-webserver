// eslint-disable-next-line no-restricted-imports -- every worker process starts here, the index would load all of the utils of the pool for it
import startWorkerProcess from './utils/start-worker-process';

const workerPath = process.argv.pop();
if (workerPath === undefined) throw new Error('workerInvoke needs the path of a worker file');

startWorkerProcess(require(workerPath));
