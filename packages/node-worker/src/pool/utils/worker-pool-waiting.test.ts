import WorkerPool from './worker-pool';
import WorkerAbandonedError from './worker-abandoned-error';
import WorkerBusyError from './worker-busy-error';
import WorkerUnavailableError from './worker-unavailable-error';
import { pathA, pathB, createPool, acquireAll } from './worker-pool.test-helper';

jest.mock('../../index', () => require('./fake-worker.test-helper').createFakeWorkerModule());

const FakeWorker = jest.requireMock('../../index').default;

describe('WorkerPool', () => {
  beforeEach(() => {
    FakeWorker.instances.length = 0;
  });

  describe('requests that wait for a worker', () => {
    const pathC = '/root/c/exampleWorker.js';

    /**
     * The overall limit is 2 and path A uses both with two busy workers, so a request for path B, which has none, has to wait: a worker of A is stopped for it as soon as one is idle.
     * A request for a path that already has workers is handed one of them at once and never waits.
     */
    const fullPool = async (params = {}) => {
      const pool = createPool({ acquireTimeout: 1000, overallLimit: 2, ...params });
      const [first, second] = await acquireAll(pool, pathA, 2, 2);

      return { pool, first, second };
    };
    const settled = (promise: Promise<unknown>) =>
      Promise.race([
        promise.then(
          () => 'resolved',
          () => 'rejected'
        ),
        new Promise((resolve) => setImmediate(() => resolve('waiting'))),
      ]);

    it('gets a worker as soon as a worker of the other path is idle, not at the next tick of a clock', async () => {
      const { pool, first, second } = await fullPool();
      const waiting = pool.acquire(pathB, {}, 1);
      expect(await settled(waiting)).toBe('waiting');

      first.release();

      expect(await settled(waiting)).toBe('resolved');
      second.release();
    });

    it('waits in line, the one that came first is served first', async () => {
      const { pool, first } = await fullPool();
      const order: string[] = [];
      const waiting = ['first', 'second', 'third'].map((name) => pool.acquire(pathB, {}, 1).then((lease) => (order.push(name), lease)));
      // a turn of the event loop, so that the requests are waiting for real before one is served: promises that are already settled call back in the order they were asked
      await new Promise((resolve) => setImmediate(resolve));

      first.release();
      await Promise.all(waiting);

      expect(order).toEqual(['first', 'second', 'third']);
    });

    it('keeps the place of a request that cannot be served yet, while the ones before it are', async () => {
      const { pool, first } = await fullPool();
      const forB = pool.acquire(pathB, {}, 1);
      const forC = pool.acquire(pathC, {}, 1);

      first.release();

      expect(await settled(forB)).toBe('resolved');
      // the only worker of A is the last one it has, so there is no room for C
      expect(await settled(forC)).toBe('waiting');
      expect(pool.getStats().waiting).toBe(1);
    });

    it('is served once room is made, by the worker of another path that stops', async () => {
      const pool = createPool({ acquireTimeout: 1000, overallLimit: 1, restartBackoff: { minUptime: 5000, base: 100, max: 400 } });
      const holder = await pool.acquire(pathA, {}, 1);
      const waiting = pool.acquire(pathB, {}, 1);
      expect(await settled(waiting)).toBe('waiting');

      // the lease is not released: it is the stopping of the worker alone that makes room
      FakeWorker.instances[0].exit(0);

      expect((await waiting).worker).toBe(FakeWorker.instances[1]);
      holder.release();
    });

    it('does not poll: it sets one timer for the time it may wait, however long it does', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      try {
        const { pool } = await fullPool();
        const timersBefore = jest.getTimerCount();
        const setTimeoutCalls = jest.spyOn(global, 'setTimeout');

        pool.acquire(pathB, {}, 1).catch(() => undefined);
        jest.advanceTimersByTime(900);

        expect(setTimeoutCalls).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(timersBefore + 1);
        setTimeoutCalls.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });

    it('stops its timer once it was served', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      try {
        const { pool, first } = await fullPool();
        const timersBefore = jest.getTimerCount();
        const waiting = pool.acquire(pathB, {}, 1);

        first.release();
        await waiting;

        // the timer of the waiting request is gone: the ones left are those that watch how long the workers have been up, the one of the worker that stopped went with it
        expect(jest.getTimerCount()).toBe(timersBefore);
      } finally {
        jest.useRealTimers();
      }
    });

    it('is refused when it waited for as long as the acquire timeout, and leaves the line', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      try {
        const { pool } = await fullPool({ acquireTimeout: 300 });
        const refused = pool.acquire(pathB, {}, 1).catch((error) => error);

        jest.advanceTimersByTime(300);

        const error = await refused;
        expect(error).toBeInstanceOf(WorkerBusyError);
        expect(error.message).toMatch(/No worker became available for .*within 300ms/);
        expect(pool.getStats()).toMatchObject({ waiting: 0, refused: { queueFull: 0, timedOut: 1 } });
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not get a worker after it gave up', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      try {
        const { pool, first } = await fullPool({ acquireTimeout: 300 });
        const refused = pool.acquire(pathB, {}, 1).catch((error) => error);
        jest.advanceTimersByTime(300);
        await refused;

        first.release();

        expect(FakeWorker.instances).toHaveLength(2);
        expect(pool.getStats().paths[pathB]).toBeUndefined();
      } finally {
        jest.useRealTimers();
      }
    });

    it('leaves the line when its signal aborts, takes no worker and does not delay the ones behind it', async () => {
      const { pool, first } = await fullPool();
      const controller = new AbortController();
      const abandoned = pool.acquire(pathB, {}, 1, controller.signal).catch((error) => error);
      const behind = pool.acquire(pathB, {}, 1);

      controller.abort();

      expect(await abandoned).toBeInstanceOf(WorkerAbandonedError);
      expect(pool.getStats()).toMatchObject({ waiting: 1, abandoned: 1, refused: { queueFull: 0, timedOut: 0 } });
      first.release();
      expect((await behind).worker).toBe(FakeWorker.instances[2]);
      expect(FakeWorker.instances).toHaveLength(3);
      expect(pool.getStats().paths[pathB]).toMatchObject({ workers: 1, active: 1 });
    });

    it('clears its deadline timer when its signal aborts', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      try {
        const { pool } = await fullPool({ acquireTimeout: 300 });
        const timersBefore = jest.getTimerCount();
        const controller = new AbortController();
        const abandoned = pool.acquire(pathB, {}, 1, controller.signal).catch((error) => error);

        controller.abort();
        await abandoned;

        expect(jest.getTimerCount()).toBe(timersBefore);
        jest.advanceTimersByTime(300);
        expect(pool.getStats()).toMatchObject({ abandoned: 1, refused: { timedOut: 0 } });
      } finally {
        jest.useRealTimers();
      }
    });

    it('is not queued when its signal aborted already', async () => {
      const { pool } = await fullPool();
      const controller = new AbortController();
      controller.abort();

      await expect(pool.acquire(pathB, {}, 1, controller.signal)).rejects.toBeInstanceOf(WorkerAbandonedError);
      expect(pool.getStats()).toMatchObject({ waiting: 0, abandoned: 1 });
    });

    it('ignores the signal once it got its worker', async () => {
      const { pool, first } = await fullPool();
      const controller = new AbortController();
      const waiting = pool.acquire(pathB, {}, 1, controller.signal);
      first.release();
      await waiting;

      controller.abort();

      expect(pool.getStats().abandoned).toBe(0);
    });

    it('is refused at once when too many wait already, and the ones that wait are not affected', async () => {
      const { pool, first } = await fullPool({ maxQueue: 2 });
      const waiting = [pool.acquire(pathB, {}, 1), pool.acquire(pathB, {}, 1)];
      const refused = pool.acquire(pathB, {}, 1);

      await expect(refused).rejects.toBeInstanceOf(WorkerBusyError);
      await expect(refused).rejects.toMatchObject({ message: expect.stringContaining('2 requests wait') });
      expect(pool.getStats()).toMatchObject({ waiting: 2, refused: { queueFull: 1 } });
      first.release();
      await Promise.all(waiting);
    });

    it('may be as many as there are, with a limit of 0', async () => {
      const { pool, first } = await fullPool({ maxQueue: 0 });

      const waiting = Array.from({ length: 200 }, () => pool.acquire(pathB, {}, 1));

      expect(pool.getStats().waiting).toBe(200);
      first.release();
      await Promise.all(waiting);
    });

    it('is told at once when the workers of its path keep crashing, instead of waiting', async () => {
      jest.useFakeTimers({ now: 1000000, doNotFake: ['setImmediate', 'nextTick'] });
      try {
        const pool = createPool({ acquireTimeout: 1000, overallLimit: 1, restartBackoff: { minUptime: 5000, base: 100, max: 400 } });
        const first = await pool.acquire(pathA, {}, 1);
        FakeWorker.instances[0].exit(1);
        first.release();
        const second = await pool.acquire(pathA, {}, 1);
        FakeWorker.instances[1].exit(1);
        second.release();

        await expect(pool.acquire(pathA, {}, 1)).rejects.toBeInstanceOf(WorkerUnavailableError);
      } finally {
        jest.useRealTimers();
      }
    });

    it('is not woken up by a pool that has nobody waiting, whatever happens to its workers', async () => {
      const pool = createPool({ overallLimit: 2 });
      const [first, second] = await acquireAll(pool, pathA, 2, 2);

      first.release();
      second.release();
      pool.warm(pathB, {});

      expect(pool.getStats().waiting).toBe(0);
    });
  });

  describe('concurrency', () => {
    it('lets a worker take no more requests than its concurrency, the next one waits for a release', async () => {
      const pool = createPool({ concurrency: 1, acquireTimeout: 1000 });
      const first = await pool.acquire(pathA, {}, 1);

      const second = pool.acquire(pathA, {}, 1);
      const settled = jest.fn();
      second.then(settled);
      await Promise.resolve();

      expect(settled).not.toHaveBeenCalled();
      expect(pool.getStats().waiting).toBe(1);

      first.release();

      expect((await second).worker).toBe(first.worker);
      expect(FakeWorker.instances).toHaveLength(1);
    });

    it('starts another worker for a request when the ones that run are full and the limit allows', async () => {
      const pool = createPool({ concurrency: 1 });

      const leases = await acquireAll(pool, pathA, 2, 2);

      expect(new Set(leases.map(({ worker }) => worker)).size).toBe(2);
    });

    it('refuses a request that waits longer than the acquire timeout for a place', async () => {
      const pool = createPool({ concurrency: 1 });
      await pool.acquire(pathA, {}, 1);

      await expect(pool.acquire(pathA, {}, 1)).rejects.toThrow(WorkerBusyError);
    });

    it('lets a request wait for a worker that is full while its path is held back after crashes', async () => {
      const pool = createPool({ concurrency: 1, restartBackoff: { minUptime: 60000, base: 60000, max: 60000 } });
      const lease = await pool.acquire(pathA, {}, 2);
      const second = await pool.acquire(pathA, {}, 2);
      lease.worker.terminate();
      FakeWorker.instances[1].exit(1);
      second.release();

      // the backoff holds a new start back, and the worker that is left is free
      await expect(pool.acquire(pathA, {}, 2)).rejects.toThrow(WorkerUnavailableError);
    });
  });

  describe('createCommand and prepareWorker', () => {
    it('starts the command the pool is given for the worker file', async () => {
      const pool = createPool({ createCommand: (workerPath: string) => ['/usr/bin/node', 'runner.js', workerPath] });

      await pool.acquire(pathA, {}, 1);

      expect(FakeWorker.instances[0].command).toEqual(['/usr/bin/node', 'runner.js', pathA]);
    });

    it('spawns with what was prepared over the options of the request, and cleans up when the worker ended', async () => {
      const onClose = jest.fn();
      const prepareWorker = jest.fn(() => ({ options: { env: { ONLY: 'this' }, execArgv: ['--permission'] }, onClose }));
      const pool = createPool({ prepareWorker });

      await pool.acquire(pathA, () => ({ cwd: '/work', env: { ALL: 'of it' } }), 1);

      expect(prepareWorker).toHaveBeenCalledWith({ workerPath: pathA, id: expect.any(String) });
      expect(FakeWorker.instances[0].options).toMatchObject({ cwd: '/work', env: { ONLY: 'this' }, execArgv: ['--permission'] });
      expect(onClose).not.toHaveBeenCalled();

      FakeWorker.instances[0].exit(0);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('cleans up at once when the worker could not be started', async () => {
      const onClose = jest.fn();
      FakeWorker.noChannel = true;
      const pool = createPool({ prepareWorker: () => ({ onClose }) });

      try {
        await expect(pool.acquire(pathA, {}, 1)).rejects.toThrow('has no channel');
      } finally {
        FakeWorker.noChannel = false;
      }

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
