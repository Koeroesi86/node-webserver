import type { EventEmitter } from 'events';
import { WORKER_EVENT } from '../constants';
import WorkerPool from './workerPool';
import WorkerAbandonedError from './workerAbandonedError';
import WorkerBusyError from './workerBusyError';
import WorkerUnavailableError from './workerUnavailableError';
import createWorkerBudget from './create-worker-budget';
import type { WorkerLease } from './workerPool';

jest.mock('@koeroesi86/node-worker', () => {
  const { EventEmitter } = require('events');
  const { Duplex } = require('stream');
  const { encodeMessage, FrameDecoder } = require('./frames');

  class FakeWorker {
    static instances: FakeWorker[] = [];
    static noChannel = false;
    /** the messages the pool sent to the worker */
    readonly sent: unknown[] = [];
    private readonly decoder = new FrameDecoder((message: unknown) => this.sent.push(message));
    private readonly socket = new Duplex({
      read() {},
      write: (chunk: Buffer, _encoding: string, callback: () => void) => {
        this.decoder.push(chunk);
        callback();
      },
    });
    /** `stdio` as the child process has it, the fourth is the channel */
    readonly instance = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdio: [null, null, null, FakeWorker.noChannel ? null : this.socket] as unknown[],
    });
    readonly terminate = jest.fn(() => this.exit(0));

    constructor(readonly command: string, readonly options: unknown) {
      FakeWorker.instances.push(this);
    }

    addEventListener = (event: string, listener: (...args: unknown[]) => unknown) => this.instance.on(event, listener);
    addEventListenerOnce = (event: string, listener: (...args: unknown[]) => unknown) => this.instance.once(event, listener);
    /** a message of the worker arrives on the channel */
    receive = (message: unknown) => this.socket.push(Buffer.concat(encodeMessage(message)));
    exit = (code: number) => {
      this.instance.exitCode = code;
      this.instance.emit('close', code);
    };
  }

  return { __esModule: true, default: FakeWorker };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const FakeWorker = require('@koeroesi86/node-worker').default;

const pathA = '/root/a/exampleWorker.js';
const pathB = '/root/b/exampleWorker.js';

const createPool = (params = {}) => new WorkerPool({ acquireTimeout: 50, ...params });
const acquireAllWith = (pool: WorkerPool, workerPath: string, options: () => object, limit: number, count: number) =>
  Array.from({ length: count }).reduce<Promise<WorkerLease[]>>(
    async (leases, _) => [...(await leases), await pool.acquire(workerPath, options, limit)],
    Promise.resolve([])
  );
const acquireAll = (pool: WorkerPool, workerPath: string, limit: number, count: number) =>
  Array.from({ length: count }).reduce<Promise<WorkerLease[]>>(
    async (leases, _) => [...(await leases), await pool.acquire(workerPath, {}, limit)],
    Promise.resolve([])
  );

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

    it('opens the channel as the fourth stdio, whatever the options say', async () => {
      const pool = createPool();

      await pool.acquire(pathA, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] }, 1);

      expect(FakeWorker.instances[0].options).toMatchObject({ stdio: ['pipe', 'pipe', 'pipe', 'overlapped'] });
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
});
