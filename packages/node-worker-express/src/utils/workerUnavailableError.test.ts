import WorkerUnavailableError from './workerUnavailableError';

describe('WorkerUnavailableError', () => {
  it('is an error that says which worker, and when to try again, and why when a message is given', () => {
    const error = new WorkerUnavailableError('/root/worker.js', 1500);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('WorkerUnavailableError');
    expect(error.workerPath).toBe('/root/worker.js');
    expect(error.retryAfterMs).toBe(1500);
    expect(error.message).toContain('/root/worker.js');
    expect(error.message).toContain('1500');
  });

  it('has a message of its own when none is given, and uses the one it is given', () => {
    expect(new WorkerUnavailableError('/root/worker.js', 1500, 'busy as a bee').message).toBe('busy as a bee');
    expect(new WorkerUnavailableError('/root/worker.js', 1500).message).toContain('keeps failing');
  });
});
