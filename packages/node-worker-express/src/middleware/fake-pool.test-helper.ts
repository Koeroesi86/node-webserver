/** the module of the pool for `jest.mock('@koeroesi86/node-worker/pool', ...)`: a pool that hands out the leases a test gives it */
export const createFakePoolModule = () => {
  class FakePool {
    static last: FakePool;
    acquire = jest.fn();
    warm = jest.fn();
    dispose = jest.fn(async () => {});
    keepWarm = jest.fn();
    getStats = () => ({ workers: 2, active: 1, waiting: 0, paths: {} });

    constructor(readonly params: { onStdout?: () => void; onStderr?: () => void; maxQueue?: number; acquireTimeout?: number }) {
      FakePool.last = this;
    }
  }

  return { ...jest.requireActual('@koeroesi86/node-worker/pool'), WorkerPool: FakePool };
};
