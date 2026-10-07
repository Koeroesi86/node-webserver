import WorkerUnavailableError from './workerUnavailableError';

describe('WorkerUnavailableError', () => {
  it('is an error that says which worker, and when to try again', () => {
    const error = new WorkerUnavailableError('/root/worker.js', 1500);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('WorkerUnavailableError');
    expect(error.workerPath).toBe('/root/worker.js');
    expect(error.retryAfterMs).toBe(1500);
    expect(error.message).toContain('/root/worker.js');
    expect(error.message).toContain('1500');
  });
});
