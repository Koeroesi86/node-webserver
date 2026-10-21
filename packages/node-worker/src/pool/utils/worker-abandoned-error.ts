/** the request stopped waiting for a worker because its client went away */
class WorkerAbandonedError extends Error {
  constructor(public readonly workerPath: string) {
    super(`The request for ${workerPath} stopped waiting for a worker, its client is gone.`);
    this.name = 'WorkerAbandonedError';
  }
}

export default WorkerAbandonedError;
