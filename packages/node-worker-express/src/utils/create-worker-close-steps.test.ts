import createWorkerRegistry from './create-worker-registry';
import createWorkerCloseSteps from './create-worker-close-steps';
import type { ClosedWorker } from './create-worker-close-steps';

interface FakeWorker {
  name: string;
}

const setup = ({ stopping = false, stable = true } = {}) => {
  const calls: string[] = [];
  const registry = createWorkerRegistry<FakeWorker, undefined>();
  const worker = { name: 'worker' };
  const entry = { workerPath: 'a.js', id: '1', lastUsed: 0 };
  registry.add(worker, entry, undefined);
  const restartBackoff = { recordFailure: jest.fn((workerPath: string) => calls.push(`failure ${workerPath}`)) };
  const steps = createWorkerCloseSteps<FakeWorker>({
    registry,
    // only the call that the steps make is needed
    restartBackoff: { ...restartBackoff, getBackoff: jest.fn(), clear: jest.fn(), getStats: jest.fn() },
    isStopping: () => stopping,
    onExit: (code, workerPath, id) => calls.push(`exit ${code} ${workerPath} ${id}`),
    wakeUp: () => calls.push('wake up'),
    checkDisposed: () => calls.push('check disposed'),
    refillWarmPaths: () => calls.push('refill'),
  });
  const close = (code: number) => {
    const closed: ClosedWorker<FakeWorker> = { worker, entry, code, uptime: { isStable: () => stable, stop: () => calls.push('stop uptime') }, leases: [] };
    steps.forEach((step) => step(closed));

    return closed;
  };

  return { registry, worker, restartBackoff, calls, close };
};

describe('createWorkerCloseSteps', () => {
  it('runs the steps in order: the requests that wait first, the paths that are kept warm last', () => {
    const { calls, close } = setup();

    close(0);

    expect(calls).toEqual(['stop uptime', 'exit 0 a.js 1', 'wake up', 'check disposed', 'refill']);
  });

  it('records a crash of a worker that was not stable yet', () => {
    const { restartBackoff, close } = setup({ stable: false });

    close(0);

    expect(restartBackoff.recordFailure).toHaveBeenCalledWith('a.js');
  });

  it('records a crash of a stable worker that ended with an error code', () => {
    const { restartBackoff, close } = setup();

    close(1);

    expect(restartBackoff.recordFailure).toHaveBeenCalledWith('a.js');
  });

  it('records no crash for a stable worker that ended cleanly', () => {
    const { restartBackoff, close } = setup();

    close(0);

    expect(restartBackoff.recordFailure).not.toHaveBeenCalled();
  });

  it('records no crash and starts no replacement for a worker the pool stopped', () => {
    const { restartBackoff, calls, close } = setup({ stopping: true, stable: false });

    close(1);

    expect([restartBackoff.recordFailure.mock.calls.length, calls.includes('refill')]).toEqual([0, false]);
  });

  it('forgets the worker and tells the requests that held it', () => {
    const { registry, worker, close } = setup();
    const onExit = jest.fn();
    registry.addLease(worker, { onExit });

    close(3);

    expect([onExit.mock.calls, registry.getWorkerCount()]).toEqual([[[3]], 0]);
  });
});
