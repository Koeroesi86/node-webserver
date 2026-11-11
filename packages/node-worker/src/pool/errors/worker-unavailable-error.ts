/** no worker can serve the request for now: the ones for the path keep crashing, or it has to wait for one for too long, or too many wait already */
class WorkerUnavailableError extends Error {
  constructor(
    readonly workerPath: string,
    /** when it is worth trying again, in milliseconds */
    readonly retryAfterMs: number,
    message = `The worker ${workerPath} keeps failing, it is not started again for ${retryAfterMs} ms.`
  ) {
    super(message);
    this.name = 'WorkerUnavailableError';
  }
}

export default WorkerUnavailableError;
