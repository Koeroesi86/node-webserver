import WorkerUnavailableError from './workerUnavailableError';

/** the request could not get a worker because the ones for the path are busy: too many requests wait for one already, or it waited for as long as it may */
class WorkerBusyError extends WorkerUnavailableError {
  constructor(workerPath: string, message: string, retryAfterMs = 1000) {
    super(workerPath, retryAfterMs, message);
    this.name = 'WorkerBusyError';
  }
}

export default WorkerBusyError;
