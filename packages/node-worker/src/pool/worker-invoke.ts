// eslint-disable-next-line no-restricted-imports -- every worker process starts here, the index would load all of the folders of the pool for it
import startWorkerProcess from './child/start-worker-process';

const workerPath = process.argv.pop();
if (workerPath === undefined) throw new Error('workerInvoke needs the path of a worker file');

startWorkerProcess(require(workerPath));
