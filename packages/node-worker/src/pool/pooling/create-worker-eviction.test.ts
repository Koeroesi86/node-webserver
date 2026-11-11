import createWorkerEviction from './create-worker-eviction';
import createWorkerRegistry from './create-worker-registry';

interface FakeWorker {
  workerPath: string;
  id: string;
  lastUsed: number;
  load: number;
}

const setup = (list: FakeWorker[]) => {
  const registry = createWorkerRegistry<FakeWorker, undefined>();
  list.forEach((worker) => registry.add(worker, worker, undefined));
  const stop = jest.fn();
  const eviction = createWorkerEviction<FakeWorker>({
    getGroups: registry.getGroups,
    getEntry: (worker) => worker,
    getLoad: (worker) => worker.load,
    unlist: registry.unlist,
    stop,
  });

  return { registry, stop, ...eviction };
};

describe('createWorkerEviction', () => {
  it('takes the worker out of the registry and stops it', () => {
    const worker = { workerPath: 'a.js', id: '1', lastUsed: 1, load: 0 };
    const { registry, stop, evict } = setup([worker, { workerPath: 'a.js', id: '2', lastUsed: 2, load: 0 }]);

    evict(worker, 'idle');

    expect(registry.getWorkersForPath('a.js')).not.toContain(worker);
    expect(stop).toHaveBeenCalledWith(worker);
  });

  it('forgets a path that has no worker left', () => {
    const worker = { workerPath: 'a.js', id: '1', lastUsed: 1, load: 0 };
    const { registry, evict } = setup([worker]);

    evict(worker, 'idle');

    expect(registry.getPathStats()).toEqual({});
  });

  it('counts the evictions by reason', () => {
    const worker = { workerPath: 'a.js', id: '1', lastUsed: 1, load: 0 };
    const { evict, getStats } = setup([worker]);

    evict(worker, 'forRoom');

    expect(getStats()).toEqual({ idle: 0, forRoom: 1 });
  });

  it('offers a spare worker of a path before the last worker of another, the one used longest ago first', () => {
    const spareOld = { workerPath: 'a.js', id: '1', lastUsed: 1, load: 0 };
    const { findIdleWorker, stop } = setup([
      { workerPath: 'b.js', id: '3', lastUsed: 0, load: 0 },
      spareOld,
      { workerPath: 'a.js', id: '2', lastUsed: 2, load: 0 },
    ]);

    findIdleWorker()?.stop();

    expect(stop).toHaveBeenCalledWith(spareOld);
  });

  it('never offers a busy worker', () => {
    const { findIdleWorker } = setup([{ workerPath: 'a.js', id: '1', lastUsed: 1, load: 1 }]);

    expect(findIdleWorker()).toBeUndefined();
  });

  it('counts a worker stopped to make room as evicted for room', () => {
    const { findIdleWorker, getStats } = setup([{ workerPath: 'a.js', id: '1', lastUsed: 1, load: 0 }]);

    findIdleWorker()?.stop();

    expect(getStats()).toEqual({ idle: 0, forRoom: 1 });
  });
});
