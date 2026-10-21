import { WORKER_EVENT } from '../constants';
import WorkerPool from './worker-pool';
import WorkerUnavailableError from './worker-unavailable-error';
import { pathA, pathB, createPool, acquireAll } from './worker-pool.test-helper';

jest.mock('../../index', () => require('./fake-worker.test-helper').createFakeWorkerModule());

const FakeWorker = jest.requireMock('../../index').default;

describe('WorkerPool', () => {
  beforeEach(() => {
    FakeWorker.instances.length = 0;
  });

  describe('workers that crash', () => {
    const restartBackoff = { minUptime: 5000, base: 100, max: 400 };

    beforeEach(() => {
      jest.useFakeTimers({ now: 1000000, doNotFake: ['setImmediate', 'nextTick'] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    /** starts a worker for the path and lets it crash right away */
    const crash = async (pool: WorkerPool, code = 1) => {
      const lease = await pool.acquire(pathA, {}, 1);
      FakeWorker.instances[FakeWorker.instances.length - 1].exit(code);
      lease.release();
    };

    it('is started again right away after the first crash', async () => {
      const pool = createPool({ restartBackoff });
      await crash(pool);

      const lease = await pool.acquire(pathA, {}, 1);

      expect(FakeWorker.instances).toHaveLength(2);
      expect(lease.worker).toBe(FakeWorker.instances[1]);
    });

    it('is not started again for a while after it crashed twice in a row, the request is refused at once', async () => {
      const pool = createPool({ restartBackoff });
      await crash(pool);
      await crash(pool);

      const refused = pool.acquire(pathA, {}, 1);

      await expect(refused).rejects.toBeInstanceOf(WorkerUnavailableError);
      await expect(refused).rejects.toMatchObject({ workerPath: pathA, retryAfterMs: 100 });
      expect(FakeWorker.instances).toHaveLength(2);
    });

    it('is started again when the time is over', async () => {
      const pool = createPool({ restartBackoff });
      await crash(pool);
      await crash(pool);

      jest.advanceTimersByTime(100);
      const lease = await pool.acquire(pathA, {}, 1);

      expect(lease.worker).toBe(FakeWorker.instances[2]);
    });

    it('waits twice as long after every crash, up to the maximum', async () => {
      const pool = createPool({ restartBackoff });
      const waits: number[] = [];

      for (let crashes = 0; crashes < 6; crashes += 1) {
        await crash(pool);
        waits.push(pool.getStats().failing[pathA].retryInMs);
        jest.advanceTimersByTime(1000);
      }

      // the first crash does not hold anything back
      expect(waits).toEqual([0, 100, 200, 400, 400, 400]);
    });

    it('counts a worker that stops with an error after it ran for a long time, but only once', async () => {
      const pool = createPool({ restartBackoff });
      await pool.acquire(pathA, {}, 1);
      jest.advanceTimersByTime(5000);

      FakeWorker.instances[0].exit(1);

      expect(pool.getStats().failing[pathA]).toEqual({ crashes: 1, retryInMs: 0 });
    });

    it('does not count a worker that stops without an error after it ran for a long time, as an idle one does', async () => {
      const pool = createPool({ restartBackoff });
      await pool.acquire(pathA, {}, 1);
      jest.advanceTimersByTime(5000);

      FakeWorker.instances[0].exit(0);

      expect(pool.getStats().failing).toEqual({});
    });

    it('counts a worker that stops without an error right after it started', async () => {
      const pool = createPool({ restartBackoff });

      await crash(pool, 0);

      expect(pool.getStats().failing[pathA]).toMatchObject({ crashes: 1 });
    });

    it('forgets the crashes once a worker has been up for a while', async () => {
      const pool = createPool({ restartBackoff });
      await crash(pool);
      await crash(pool);
      jest.advanceTimersByTime(100);
      await pool.acquire(pathA, {}, 1);

      jest.advanceTimersByTime(5000);

      expect(pool.getStats().failing).toEqual({});
    });

    it('does not count the workers that the pool stops itself', async () => {
      const pool = createPool({ restartBackoff, overallLimit: 2 });
      (await acquireAll(pool, pathA, 2, 2)).forEach((lease) => lease.release());
      (await acquireAll(pool, pathB, 1, 1))[0].release();

      pool.onClose();

      expect(pool.getStats().failing).toEqual({});
    });

    it('keeps the crashes of one path from holding back another', async () => {
      const pool = createPool({ restartBackoff });
      await crash(pool);
      await crash(pool);

      const lease = await pool.acquire(pathB, {}, 1);

      expect(lease.worker).toBe(FakeWorker.instances[2]);
    });

    it('hands out the workers that still run, instead of refusing, while no new one may be started', async () => {
      const pool = createPool({ restartBackoff });
      const [first, second] = await acquireAll(pool, pathA, 2, 2);
      first.release();
      second.release();
      // two crashes in a row, while the other worker keeps running
      const busy = FakeWorker.instances[0];
      await crash(pool);
      FakeWorker.instances[FakeWorker.instances.length - 1].exit(1);

      const lease = await pool.acquire(pathA, {}, 3);

      expect([busy, FakeWorker.instances[1]]).toContain(lease.worker);
    });

    it('does not warm a worker for a path that is held back', async () => {
      const pool = createPool({ restartBackoff });
      await crash(pool);
      await crash(pool);

      pool.warm(pathA, {});

      expect(FakeWorker.instances).toHaveLength(2);
    });
  });

  describe('start timeout', () => {
    afterEach(() => jest.useRealTimers());

    it('resolves the lease once the worker said it is ready', async () => {
      const pool = createPool({ startTimeout: 1000 });
      const lease = await pool.acquire(pathA, {}, 1);
      const ready = jest.fn();
      lease.ready().then(ready);
      await Promise.resolve();

      expect(ready).not.toHaveBeenCalled();
      expect(pool.getStats().starting).toBe(1);

      FakeWorker.instances[0].receive({ type: WORKER_EVENT.READY, requestId: '' });
      await lease.ready();

      expect(pool.getStats().starting).toBe(0);
    });

    it('is ready as it starts without a start timeout', async () => {
      const lease = await createPool().acquire(pathA, {}, 1);

      await expect(lease.ready()).resolves.toBeUndefined();
    });

    it('kills a worker that is not ready in time, fails its lease and counts a crash', async () => {
      jest.useFakeTimers();
      const pool = createPool({ startTimeout: 1000, acquireTimeout: 5000 });
      const lease = await pool.acquire(pathA, {}, 1);
      const failure = expect(lease.ready()).rejects.toThrow(/did not start: it was not ready within 1000ms/);

      jest.advanceTimersByTime(1000);
      await failure;

      expect(FakeWorker.instances[0].terminate).toHaveBeenCalledWith('SIGKILL');
      expect(pool.getStats().failing[pathA].crashes).toBe(1);
    });

    it('fails the lease of a worker that ended before it was ready', async () => {
      const pool = createPool({ startTimeout: 1000 });
      const lease = await pool.acquire(pathA, {}, 1);

      FakeWorker.instances[0].exit(1);

      await expect(lease.ready()).rejects.toThrow('it exited with code 1');
    });

    it('wakes the requests that wait when a worker becomes ready', async () => {
      const pool = createPool({ startTimeout: 1000, concurrency: 1, acquireTimeout: 1000 });
      const first = await pool.acquire(pathA, {}, 1);
      FakeWorker.instances[0].receive({ type: WORKER_EVENT.READY, requestId: '' });
      await first.ready();
      const second = pool.acquire(pathA, {}, 1);

      first.release();

      expect((await second).worker).toBe(first.worker);
    });
  });

  describe('maximum age', () => {
    afterEach(() => jest.useRealTimers());

    it('stops an idle worker that is too old, and starts another one for the next request', async () => {
      jest.useFakeTimers();
      const pool = createPool({ maxAge: 1000 });
      const first = await pool.acquire(pathA, {}, 1);
      first.release();

      jest.advanceTimersByTime(1000);
      const second = await pool.acquire(pathA, {}, 1);

      expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
      expect(second.worker).not.toBe(first.worker);
    });

    it('lets a worker finish its request first, and stops it after', async () => {
      jest.useFakeTimers();
      const pool = createPool({ maxAge: 1000 });
      const lease = await pool.acquire(pathA, {}, 1);

      jest.advanceTimersByTime(1000);
      expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled();

      lease.release();

      expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    });

    it('does not hand out a worker that is too old', async () => {
      jest.useFakeTimers();
      const pool = createPool({ maxAge: 1000 });
      const busy = await pool.acquire(pathA, {}, 2);

      jest.advanceTimersByTime(1000);
      const next = await pool.acquire(pathA, {}, 2);

      expect(next.worker).not.toBe(busy.worker);
    });
  });
});
