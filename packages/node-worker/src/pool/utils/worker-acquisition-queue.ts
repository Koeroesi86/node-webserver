import { WaitingLine } from '../../index';
import WorkerAbandonedError from './worker-abandoned-error';
import WorkerBusyError from './worker-busy-error';

interface QueuedRequest {
  workerPath: string;
}

/** the requests that wait for a worker, see the waiting line of node-worker */
class WorkerAcquisitionQueue<Request extends QueuedRequest, Result> extends WaitingLine<Request, Result> {
  constructor(acquireTimeout: number, maxQueue: number) {
    super({
      acquireTimeout,
      maxQueue,
      createFullError: ({ workerPath }, waiting) => new WorkerBusyError(workerPath, `${waiting} requests wait for a worker for ${workerPath} already.`),
      createTimeoutError: ({ workerPath }, timeout) => new WorkerBusyError(workerPath, `No worker became available for ${workerPath} within ${timeout}ms.`),
      createAbandonedError: ({ workerPath }) => new WorkerAbandonedError(workerPath),
    });
  }
}

export default WorkerAcquisitionQueue;
