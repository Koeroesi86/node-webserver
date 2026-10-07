/** a worker for the path keeps crashing, and is not started again for a while */
class WorkerUnavailableError extends Error {
  constructor(readonly workerPath: string, readonly retryAfterMs: number) {
    super(`The worker ${workerPath} keeps failing, it is not started again for ${retryAfterMs} ms.`);
    this.name = 'WorkerUnavailableError';
  }
}

export default WorkerUnavailableError;
