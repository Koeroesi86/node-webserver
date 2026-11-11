/** the worker did not become ready: it ended, or took longer than the start timeout */
class WorkerStartError extends Error {
  constructor(
    readonly workerPath: string,
    reason: string
  ) {
    super(`The worker ${workerPath} did not start: ${reason}`);
    this.name = 'WorkerStartError';
  }
}

export default WorkerStartError;
