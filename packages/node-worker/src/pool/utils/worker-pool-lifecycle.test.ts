import type { EventEmitter } from 'events';
import WorkerPool from './workerPool';
import createWorkerBudget from './create-worker-budget';
import { pathA, pathB, createPool, acquireAll } from './worker-pool.test-helper';

jest.mock('../../index', () => require('./fake-worker.test-helper').createFakeWorkerModule());

const FakeWorker = jest.requireMock('../../index').default;

describe('WorkerPool', () => {
  beforeEach(() => {
    FakeWorker.instances.length = 0;
  });

  describe('dispose', () => {
    it('stops the idle workers at once, and resolves once they stopped', async () => {
      const pool = createPool();
      (await acquireAll(pool, pathA, 1, 1))[0].release();
      (await acquireAll(pool, pathB, 1, 1))[0].release();

      await pool.dispose(1000);

      expect(FakeWorker.instances.map((worker) => worker.terminate.mock.calls.length)).toEqual([1, 1]);
      expect(pool.getWorkerCount()).toBe(0);
    });

    it('stops a busy worker once it answered its requests', async () => {
      const pool = createPool();
      const [lease] = await acquireAll(pool, pathA, 1, 1);
      const disposed = jest.fn();

      pool.dispose(1000).then(disposed);
      await Promise.resolve();
      expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled();
      lease.release();
      await Promise.resolve();

      expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
      expect(disposed).toHaveBeenCalled();
    });

    it('stops a busy worker after the timeout', async () => {
      jest.useFakeTimers();
      try {
        const pool = createPool();
        await acquireAll(pool, pathA, 1, 1);

        const disposed = pool.dispose(1000);
        jest.advanceTimersByTime(1000);
        await disposed;

        expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('leaves its budget once its workers stopped', async () => {
      const budget = createWorkerBudget(1);
      const pool = createPool({ budget });
      (await acquireAll(pool, pathA, 1, 1))[0].release();
      const leave = jest.spyOn(budget, 'leave');

      await pool.dispose(1000);

      expect(leave).toHaveBeenCalledWith(pool);
    });

    it('serves a request that still comes with a worker of its own, not with one that is being stopped', async () => {
      const pool = createPool();
      const [busy] = await acquireAll(pool, pathA, 1, 1);
      FakeWorker.instances[0].terminate.mockImplementation(() => {});
      pool.dispose(1000);
      busy.release();

      const lease = await pool.acquire(pathA, {}, 1);

      expect(lease.worker).toBe(FakeWorker.instances[1]);
    });
  });

  describe('warm', () => {
    it('starts a worker that the first request gets, without starting another one', async () => {
      const pool = createPool();

      pool.warm(pathA, {});
      expect(FakeWorker.instances).toHaveLength(1);
      const lease = await pool.acquire(pathA, {}, 4);

      expect(lease.worker).toBe(FakeWorker.instances[0]);
      expect(FakeWorker.instances).toHaveLength(1);
    });

    it('starts as many workers as asked for, and not more when called again', () => {
      const pool = createPool();

      pool.warm(pathA, {}, 3);
      pool.warm(pathA, {}, 3);

      expect(FakeWorker.instances).toHaveLength(3);
    });

    it('does not go beyond the overall limit', () => {
      const pool = createPool({ overallLimit: 2 });

      pool.warm(pathA, {}, 5);
      pool.warm(pathB, {});

      expect(pool.getWorkerCount()).toBe(2);
    });
  });

  describe('keepWarm', () => {
    const restartBackoff = { minUptime: 5000, base: 100, max: 400 };

    beforeEach(() => {
      jest.useFakeTimers({ now: 1000000, doNotFake: ['setImmediate', 'nextTick'] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('starts a worker again when one stopped itself while it was idle', () => {
      const pool = createPool({ restartBackoff });
      pool.keepWarm(pathA, {}, 2);
      jest.advanceTimersByTime(5000);

      FakeWorker.instances[0].exit(0);

      expect(FakeWorker.instances).toHaveLength(3);
      expect(pool.getWorkerCountForPath(pathA)).toBe(2);
    });

    it('starts the workers with the options it was given', () => {
      const pool = createPool({ restartBackoff });
      const options = { cwd: '/somewhere' };
      pool.keepWarm(pathA, options);

      FakeWorker.instances[0].exit(0);

      expect(FakeWorker.instances[1].options).toMatchObject(options);
    });

    it('waits for the backoff of a path whose workers keep crashing, and tries once when it is over', () => {
      const pool = createPool({ restartBackoff });
      pool.keepWarm(pathA, {});
      FakeWorker.instances[0].exit(1);
      FakeWorker.instances[1].exit(1);

      expect(FakeWorker.instances).toHaveLength(2);
      jest.advanceTimersByTime(100);

      expect(FakeWorker.instances).toHaveLength(3);
    });

    it('leaves the room under the overall limit to a request that waits for a worker', async () => {
      const pool = createPool({ restartBackoff, overallLimit: 1, acquireTimeout: 1000 });
      pool.keepWarm(pathA, {});
      const waiting = pool.acquire(pathB, {}, 1);

      FakeWorker.instances[0].exit(0);
      const lease = await waiting;

      expect(lease.worker).toBe(FakeWorker.instances[1]);
      expect(pool.getWorkerCountForPath(pathA)).toBe(0);
      expect(FakeWorker.instances).toHaveLength(2);
    });

    it('takes the room again once the worker of the other path stopped', async () => {
      const pool = createPool({ restartBackoff, overallLimit: 1, acquireTimeout: 1000 });
      pool.keepWarm(pathA, {});
      const waiting = pool.acquire(pathB, {}, 1);
      FakeWorker.instances[0].exit(0);
      (await waiting).release();

      FakeWorker.instances[1].exit(0);

      expect(pool.getWorkerCountForPath(pathA)).toBe(1);
    });

    it('is not stopped for being idle, however long it has had no request', () => {
      const idleTimeout = 60000;
      const pool = createPool({ restartBackoff, idleTimeout });
      pool.keepWarm(pathA, {});

      jest.advanceTimersByTime(idleTimeout * 3);

      expect(pool.getWorkerCountForPath(pathA)).toBe(1);
      expect(pool.getStats().evicted).toEqual({ idle: 0, forRoom: 0 });
    });

    it('stops the idle workers above the minimum, and keeps the minimum', async () => {
      const idleTimeout = 60000;
      const pool = createPool({ restartBackoff, idleTimeout });
      pool.keepWarm(pathA, {});
      const leases = await acquireAll(pool, pathA, 3, 3);
      leases.forEach((lease) => lease.release());

      jest.advanceTimersByTime(idleTimeout * 2);

      expect(pool.getWorkerCountForPath(pathA)).toBe(1);
      expect(pool.getStats().evicted).toEqual({ idle: 2, forRoom: 0 });
    });

    it('gives up an idle worker for the first worker of another path', async () => {
      const pool = createPool({ restartBackoff, overallLimit: 1 });
      pool.keepWarm(pathA, {});

      const lease = await pool.acquire(pathB, {}, 1);

      expect(lease.worker).toBe(FakeWorker.instances[1]);
      expect(pool.getWorkerCountForPath(pathA)).toBe(0);
    });

    it('stops keeping a path warm once the pool is disposed of', async () => {
      const pool = createPool({ restartBackoff });
      pool.keepWarm(pathA, {});
      const disposed = pool.dispose(1000);

      FakeWorker.instances[0].exit(0);
      await disposed;

      expect(FakeWorker.instances).toHaveLength(1);
    });

    it('starts nothing once the pool is closed', () => {
      const pool = createPool({ restartBackoff });
      pool.keepWarm(pathA, {});

      pool.onClose();

      expect(FakeWorker.instances).toHaveLength(1);
      expect(pool.getWorkerCount()).toBe(0);
    });
  });

  describe('getStats', () => {
    it('counts the workers, the requests they handle and the ones that wait, per path', async () => {
      const pool = createPool({ overallLimit: 3 });
      const leases = [...(await acquireAll(pool, pathA, 2, 3)), await pool.acquire(pathB, {}, 1)];

      const waiting = pool.acquire('/root/c/exampleWorker.js', {}, 1).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const stats = pool.getStats();
      await waiting;

      expect(stats).toMatchObject({ workers: 3, active: 4, waiting: 1 });
      expect(stats.paths).toEqual({ [pathA]: { workers: 2, active: 3 }, [pathB]: { workers: 1, active: 1 } });
      leases.forEach((lease) => lease.release());
    });

    it('stops counting a request as waiting once it got a worker or gave up', async () => {
      const pool = createPool({ overallLimit: 1, acquireTimeout: 30 });
      await pool.acquire(pathA, {}, 1);

      await expect(pool.acquire(pathB, {}, 1)).rejects.toThrow(/No worker became available/);

      expect(pool.getStats().waiting).toBe(0);
    });

    it('is empty for a pool that has not started a worker', () => {
      expect(createPool().getStats()).toEqual({
        workers: 0,
        starting: 0,
        active: 0,
        waiting: 0,
        refused: { queueFull: 0, timedOut: 0 },
        abandoned: 0,
        evicted: { idle: 0, forRoom: 0 },
        failing: {},
        paths: {},
      });
    });
  });

  describe('output of the workers', () => {
    const output = (worker: { instance: { stdout: EventEmitter; stderr: EventEmitter } }) => ({
      stdout: worker.instance.stdout,
      stderr: worker.instance.stderr,
    });

    it('hands what a worker writes to the callbacks, from the moment it starts', () => {
      const onStdout = jest.fn();
      const onStderr = jest.fn();
      const pool = createPool({ onStdout, onStderr });

      pool.warm(pathA, {});
      output(FakeWorker.instances[0]).stdout.emit('data', Buffer.from('out'));
      output(FakeWorker.instances[0]).stderr.emit('data', Buffer.from('err'));

      expect(onStdout).toHaveBeenCalledWith(Buffer.from('out'));
      expect(onStderr).toHaveBeenCalledWith(Buffer.from('err'));
    });

    it('listens once for a worker, however many requests it gets', async () => {
      const pool = createPool({ onStdout: jest.fn(), onStderr: jest.fn() });

      await Promise.all(Array.from({ length: 5 }, async () => (await pool.acquire(pathA, {}, 1)).release()));
      Array.from({ length: 5 }).forEach(async () => (await pool.acquire(pathA, {}, 1)).release());

      const { stdout, stderr } = output(FakeWorker.instances[0]);
      expect([stdout.listenerCount('data'), stderr.listenerCount('data')]).toEqual([1, 1]);
    });

    it('does not listen when there is nothing to hand the output to', async () => {
      await createPool().acquire(pathA, {}, 1);

      const { stdout, stderr } = output(FakeWorker.instances[0]);
      expect([stdout.listenerCount('data'), stderr.listenerCount('data')]).toEqual([0, 0]);
    });
  });

  describe('stopping', () => {
    afterEach(() => jest.useRealTimers());

    it('stops with the signal it is given and kills a worker that is still there after the grace time', async () => {
      jest.useFakeTimers();
      const pool = createPool({ stopSignal: 'SIGTERM', killAfter: 5000 });
      const lease = await pool.acquire(pathA, {}, 1);
      const [worker] = FakeWorker.instances;
      // a worker that ignores the signal
      worker.terminate.mockImplementation(() => {});
      lease.release();

      pool.onClose();
      expect(worker.terminate).toHaveBeenCalledWith('SIGTERM');

      jest.advanceTimersByTime(5000);
      expect(worker.terminate).toHaveBeenLastCalledWith('SIGKILL');
    });

    it('does not kill a worker that stopped in time', async () => {
      jest.useFakeTimers();
      const pool = createPool({ killAfter: 5000 });
      await pool.acquire(pathA, {}, 1);
      const [worker] = FakeWorker.instances;

      pool.onClose();
      jest.advanceTimersByTime(5000);

      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('kills a worker on request without counting a crash', async () => {
      const pool = createPool();
      const lease = await pool.acquire(pathA, {}, 1);

      lease.kill();
      lease.release();

      expect(FakeWorker.instances[0].terminate).toHaveBeenCalledWith('SIGKILL');
      expect(pool.getStats().failing).toEqual({});
    });
  });
});
