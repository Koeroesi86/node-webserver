import net from 'net';
import { WORKER_EVENT } from '../constants';
import WorkerPool from './worker-pool';
import createWorkerBudget from './create-worker-budget';
import { pathA, pathB, createPool, acquireAllWith, acquireAll } from './worker-pool.test-helper';

jest.mock('../../index', () => require('./fake-worker.test-helper').createFakeWorkerModule());

const FakeWorker = jest.requireMock('../../index').default;

describe('WorkerPool', () => {
  beforeEach(() => {
    FakeWorker.instances.length = 0;
  });

  it('keeps reusing a single worker while it is idle', async () => {
    const pool = createPool();

    const first = await pool.acquire(pathA, {}, 4);
    first.release();
    const second = await pool.acquire(pathA, {}, 4);

    expect(second.worker).toBe(first.worker);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('starts more workers only while all running ones are busy, up to the limit', async () => {
    const pool = createPool();

    const leases = await acquireAll(pool, pathA, 3, 5);

    expect(FakeWorker.instances).toHaveLength(3);
    expect(new Set(leases.map(({ worker }) => worker)).size).toBe(3);
  });

  it('keeps a single worker when the limit is 0', async () => {
    const pool = createPool();

    await acquireAll(pool, pathA, 0, 4);

    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('hands out the least busy worker, equally loaded ones take turns', async () => {
    const pool = createPool();
    const [first, second] = await acquireAll(pool, pathA, 2, 2);

    const third = await pool.acquire(pathA, {}, 2);
    const fourth = await pool.acquire(pathA, {}, 2);
    first.release();
    const fifth = await pool.acquire(pathA, {}, 2);

    expect(new Set([third.worker, fourth.worker])).toEqual(new Set([first.worker, second.worker]));
    expect(fifth.worker).toBe(first.worker);
  });

  it('does not let a busy path use up the overall limit for other paths', async () => {
    const pool = createPool({ overallLimit: 3 });
    const leases = await acquireAll(pool, pathA, 4, 3);

    // all workers of the path are busy, so none of them can make room
    await expect(pool.acquire(pathB, {}, 4)).rejects.toThrow(/No worker became available/);

    leases[0].release();
    const other = await pool.acquire(pathB, {}, 4);

    expect(pool.getWorkerCountForPath(pathA)).toBe(2);
    expect(pool.getWorkerCountForPath(pathB)).toBe(1);
    expect(other.worker).toBe(FakeWorker.instances[3]);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
  });

  it('never takes the last worker of a path away while the path has requests', async () => {
    const pool = createPool({ overallLimit: 2 });
    await pool.acquire(pathA, {}, 1);
    await pool.acquire(pathB, {}, 1);

    await expect(pool.acquire('/root/c/exampleWorker.js', {}, 1)).rejects.toThrow(/No worker became available/);
    expect(pool.getWorkerCount()).toBe(2);
  });

  describe('making room for the first worker of a path', () => {
    const pathC = '/root/c/exampleWorker.js';

    beforeEach(() => {
      jest.useFakeTimers({ now: 1000000, doNotFake: ['setImmediate', 'nextTick'] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    /** a request for the path that is finished at the given time, so that its worker is idle since then */
    const use = async (pool: WorkerPool, workerPath: string, at: number) => {
      jest.setSystemTime(at);
      const lease = await pool.acquire(workerPath, {}, 1);
      lease.release();
      return lease.worker;
    };

    it('takes the last worker of a path that has no requests, the one used longest ago', async () => {
      const pool = createPool({ overallLimit: 2 });
      const second = await use(pool, pathB, 1000);
      const first = await use(pool, pathA, 2000);

      const lease = await pool.acquire(pathC, {}, 1);

      expect(second.terminate).toHaveBeenCalled();
      expect(first.terminate).not.toHaveBeenCalled();
      expect(pool.getStats().paths).toEqual({ [pathA]: { workers: 1, active: 0 }, [pathC]: { workers: 1, active: 1 } });
      expect(pool.getStats().evicted).toEqual({ idle: 0, forRoom: 1 });
      lease.release();
    });

    it('takes a second worker of a path before the last worker of another, even one used longer ago', async () => {
      const pool = createPool({ overallLimit: 3 });
      const last = await use(pool, pathB, 1000);
      jest.setSystemTime(2000);
      const [first, second] = await acquireAll(pool, pathA, 2, 2);
      first.release();
      second.release();

      await pool.acquire(pathC, {}, 1);

      expect(last.terminate).not.toHaveBeenCalled();
      const stopped = FakeWorker.instances.filter((worker: { terminate: jest.Mock }) => worker.terminate.mock.calls.length > 0);
      expect(stopped).toHaveLength(1);
      expect([first.worker, second.worker]).toContain(stopped[0]);
      expect(pool.getWorkerCountForPath(pathA)).toBe(1);
    });

    it('does not take a worker that has a request', async () => {
      const pool = createPool({ overallLimit: 2, acquireTimeout: 1000 });
      const busy = await pool.acquire(pathA, {}, 1);
      const idle = await use(pool, pathB, 2000);

      await pool.acquire(pathC, {}, 1);

      expect(idle.terminate).toHaveBeenCalled();
      expect(busy.worker.terminate).not.toHaveBeenCalled();
    });
  });

  describe('a budget shared with other pools', () => {
    const pathC = '/root/c/exampleWorker.js';
    const settled = (promise: Promise<unknown>) =>
      Promise.race([
        promise.then(
          () => 'resolved',
          () => 'rejected'
        ),
        new Promise((resolve) => setImmediate(() => resolve('waiting'))),
      ]);

    it('keeps the workers of all the pools under its limit', async () => {
      const budget = createWorkerBudget(2);
      const pools = [createPool({ budget }), createPool({ budget })];
      await acquireAll(pools[0], pathA, 2, 2);

      await expect(pools[1].acquire(pathB, {}, 1)).rejects.toThrow(/No worker became available/);
      expect(budget.getStats()).toEqual({ limit: 2, workers: 2 });
    });

    it('stops an idle worker of another pool to make room', async () => {
      const budget = createWorkerBudget(2);
      const pools = [createPool({ budget }), createPool({ budget })];
      const [idle] = await acquireAll(pools[0], pathA, 2, 2);
      idle.release();

      await pools[1].acquire(pathB, {}, 1);

      expect(idle.worker.terminate).toHaveBeenCalled();
      expect(pools[0].getStats().evicted).toEqual({ idle: 0, forRoom: 1 });
      expect(budget.getStats()).toEqual({ limit: 2, workers: 2 });
    });

    it('serves a request that waits in one pool as soon as a worker of another pool is idle', async () => {
      const budget = createWorkerBudget(2);
      const pools = [createPool({ budget, acquireTimeout: 1000 }), createPool({ budget, acquireTimeout: 1000 })];
      const [first] = await acquireAll(pools[0], pathA, 2, 2);
      const waiting = pools[1].acquire(pathC, {}, 1);
      expect(await settled(waiting)).toBe('waiting');

      first.release();

      expect(await settled(waiting)).toBe('resolved');
    });

    it('does not warm beyond its limit', () => {
      const budget = createWorkerBudget(1);
      const pools = [createPool({ budget }), createPool({ budget })];

      pools[0].warm(pathA, {}, 1);
      pools[1].warm(pathB, {}, 1);

      expect(FakeWorker.instances).toHaveLength(1);
    });
  });

  describe('idle workers', () => {
    const idleTimeout = 60000;

    beforeEach(() => {
      jest.useFakeTimers({ now: 1000000, doNotFake: ['setImmediate', 'nextTick'] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('are stopped once they had no request for the idle timeout, and the path is forgotten', async () => {
      const pool = createPool({ idleTimeout });
      (await pool.acquire(pathA, {}, 1)).release();

      jest.advanceTimersByTime(idleTimeout - 1);
      expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);

      expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
      expect(pool.getStats()).toMatchObject({ workers: 0, paths: {}, evicted: { idle: 1, forRoom: 0 } });
    });

    it('are timed from the end of their last request', async () => {
      const pool = createPool({ idleTimeout });
      (await pool.acquire(pathA, {}, 1)).release();

      jest.advanceTimersByTime(idleTimeout - 1);
      (await pool.acquire(pathA, {}, 1)).release();
      jest.advanceTimersByTime(idleTimeout - 1);

      expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled();
    });

    it('are not stopped while they have a request, however long it takes', async () => {
      const pool = createPool({ idleTimeout });
      const lease = await pool.acquire(pathA, {}, 1);

      jest.advanceTimersByTime(idleTimeout * 3);
      expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled();
      lease.release();
      jest.advanceTimersByTime(idleTimeout);

      expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
    });

    it('are stopped also when they never had a request', () => {
      const pool = createPool({ idleTimeout });
      pool.warm(pathA, {});

      jest.advanceTimersByTime(idleTimeout);

      expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
    });

    it('are kept with an idle timeout of 0', async () => {
      const pool = createPool();
      (await pool.acquire(pathA, {}, 1)).release();

      jest.advanceTimersByTime(idleTimeout * 100);

      expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled();
    });

    it('hand a request that arrives while one is being stopped a new worker, and the one that stops is no crash', async () => {
      const pool = createPool({ idleTimeout, restartBackoff: { minUptime: 5000, base: 100, max: 400 } });
      (await pool.acquire(pathA, {}, 1)).release();
      const stopping = FakeWorker.instances[0];
      // the process takes its time to close, as a real one does
      stopping.terminate.mockImplementation(() => {});
      jest.advanceTimersByTime(idleTimeout);

      const lease = await pool.acquire(pathA, {}, 1);
      stopping.exit(0);

      expect(lease.worker).not.toBe(stopping);
      expect(FakeWorker.instances).toHaveLength(2);
      expect(pool.getStats()).toMatchObject({ workers: 1, failing: {}, paths: { [pathA]: { workers: 1, active: 1 } } });
      lease.release();
    });
  });

  it('delivers the messages of a worker to the request they belong to only', async () => {
    const pool = createPool();
    const first = await pool.acquire(pathA, {}, 1);
    const second = await pool.acquire(pathA, {}, 1);
    const onFirst = jest.fn();
    const onSecond = jest.fn();
    first.subscribe('one', onFirst, jest.fn());
    second.subscribe('two', onSecond, jest.fn());

    FakeWorker.instances[0].receive({ requestId: 'two', type: 'WORKER_RESPONSE' });
    FakeWorker.instances[0].receive({ requestId: 'unknown', type: 'WORKER_RESPONSE' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(onSecond).toHaveBeenCalledTimes(1);
    expect(onFirst).not.toHaveBeenCalled();
  });

  it('stops delivering messages once the lease is released', async () => {
    const pool = createPool();
    const lease = await pool.acquire(pathA, {}, 1);
    const onMessage = jest.fn();
    lease.subscribe('one', onMessage, jest.fn());

    lease.release();
    lease.release();
    FakeWorker.instances[0].receive({ requestId: 'one' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('tells the running requests when their worker exits and starts a new one afterwards', async () => {
    const onExit = jest.fn();
    const pool = createPool({ onExit });
    const lease = await pool.acquire(pathA, {}, 1);
    const onWorkerExit = jest.fn();
    lease.subscribe('one', jest.fn(), onWorkerExit);

    FakeWorker.instances[0].exit(1);
    const replacement = await pool.acquire(pathA, {}, 1);

    expect(onWorkerExit).toHaveBeenCalledWith(1);
    expect(onExit).toHaveBeenCalledWith(1, pathA, expect.any(String));
    expect(replacement.worker).toBe(FakeWorker.instances[1]);
  });

  it('does not hand out a worker that already exited', async () => {
    const pool = createPool();
    (await pool.acquire(pathA, {}, 1)).release();
    FakeWorker.instances[0].instance.exitCode = 1;

    const lease = await pool.acquire(pathA, {}, 1);

    expect(lease.worker).toBe(FakeWorker.instances[1]);
  });

  describe('spawn options', () => {
    it('makes them only when a worker is started, not for every request', async () => {
      const pool = createPool();
      const options = jest.fn(() => ({ env: { FROM: 'factory' } }));

      const leases = await acquireAllWith(pool, pathA, options, 2, 6);
      leases.forEach((lease) => lease.release());
      await pool.acquire(pathA, options, 2);

      expect(FakeWorker.instances).toHaveLength(2);
      expect(options).toHaveBeenCalledTimes(2);
    });

    it('hands what the factory made to the worker', async () => {
      const pool = createPool();

      await pool.acquire(pathA, () => ({ env: { FROM: 'factory' } }), 1);

      expect(FakeWorker.instances[0].options).toMatchObject({ env: { FROM: 'factory' } });
    });

    it('opens the channel as the fourth stdio and the IPC channel as the fifth, whatever the options say', async () => {
      const pool = createPool();

      await pool.acquire(pathA, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] }, 1);

      expect(FakeWorker.instances[0].options).toMatchObject({ stdio: ['pipe', 'pipe', 'pipe', 'overlapped', 'ipc'] });
    });
  });

  describe('sending', () => {
    it('sends messages to the worker of the lease only', async () => {
      const pool = createPool();
      const first = await pool.acquire(pathA, {}, 2);
      const second = await pool.acquire(pathA, {}, 2);

      second.send({ type: WORKER_EVENT.REQUEST_ABORT, requestId: 'one' });
      await new Promise((resolve) => setImmediate(resolve));

      expect(FakeWorker.instances[0].sent).toEqual([]);
      expect(FakeWorker.instances[1].sent).toEqual([{ type: WORKER_EVENT.REQUEST_ABORT, requestId: 'one' }]);
      expect(first.worker).toBe(FakeWorker.instances[0]);
    });

    it('hands a connection to the worker of the lease over the IPC channel', async () => {
      const pool = createPool();
      const lease = await pool.acquire(pathA, {}, 1);
      const socket = new net.Socket();
      const message = { type: WORKER_EVENT.RESPONSE_HANDOFF, requestId: 'one', timeout: 100 } as const;

      await lease.handOff(message, socket);

      expect(FakeWorker.instances[0].instance.send).toHaveBeenCalledWith(message, socket, expect.any(Function));
    });

    it('rejects a hand over that could not be sent', async () => {
      const pool = createPool();
      const lease = await pool.acquire(pathA, {}, 1);
      FakeWorker.instances[0].instance.send.mockImplementationOnce((message, handle, callback) => callback(new Error('closed')));

      await expect(lease.handOff({ type: WORKER_EVENT.RESPONSE_HANDOFF, requestId: 'one', timeout: 0 }, new net.Socket())).rejects.toThrow('closed');
    });

    it('rejects a hand over to a worker without an IPC channel', async () => {
      const pool = createPool();
      const lease = await pool.acquire(pathA, {}, 1);
      FakeWorker.instances[0].instance.connected = false;

      await expect(lease.handOff({ type: WORKER_EVENT.RESPONSE_HANDOFF, requestId: 'one', timeout: 0 }, new net.Socket())).rejects.toThrow('no IPC channel');
      expect(FakeWorker.instances[0].instance.send).not.toHaveBeenCalled();
    });

    it('does not fail when the worker is gone', async () => {
      const pool = createPool();
      const lease = await pool.acquire(pathA, {}, 1);
      FakeWorker.instances[0].exit(1);

      expect(() => lease.send({ type: WORKER_EVENT.REQUEST_ABORT, requestId: 'one' })).not.toThrow();
    });

    it('does not start a worker that has no channel', async () => {
      const pool = createPool();
      FakeWorker.noChannel = true;

      await expect(pool.acquire(pathA, {}, 1)).rejects.toThrow(/has no channel/);
      FakeWorker.noChannel = false;

      expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
    });
  });

  describe('stopping when the process exits', () => {
    it('stops the workers of a pool with a budget of its own, until it is disposed of', async () => {
      const before = process.listenerCount('exit');
      const pool = createPool();
      expect(process.listenerCount('exit')).toBe(before + 1);

      await pool.dispose(1000);

      expect(process.listenerCount('exit')).toBe(before);
    });

    it('leaves it to the budget that is given, which stops all of its pools at once', async () => {
      const before = process.listenerCount('exit');
      const budget = createWorkerBudget();
      const pools = [createPool({ budget }), createPool({ budget })];
      await pools[0].acquire(pathA, {}, 1);
      await pools[1].acquire(pathB, {}, 1);
      expect(process.listenerCount('exit')).toBe(before);

      budget.close();

      expect(FakeWorker.instances.map((worker) => worker.terminate.mock.calls.length)).toEqual([1, 1]);
    });
  });
});
