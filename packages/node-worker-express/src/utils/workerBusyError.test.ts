import WorkerBusyError from './workerBusyError';
import WorkerUnavailableError from './workerUnavailableError';

describe('WorkerBusyError', () => {
  it('is an unavailable worker, with a message that says why, and a second to wait by default', () => {
    const error = new WorkerBusyError('/root/worker.js', 'No worker became available for /root/worker.js within 50ms.');

    expect(error).toBeInstanceOf(WorkerUnavailableError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('WorkerBusyError');
    expect(error.workerPath).toBe('/root/worker.js');
    expect(error.retryAfterMs).toBe(1000);
    expect(error.message).toBe('No worker became available for /root/worker.js within 50ms.');
  });

  it('takes the time to wait', () => {
    expect(new WorkerBusyError('/root/worker.js', 'busy', 250).retryAfterMs).toBe(250);
  });
});
