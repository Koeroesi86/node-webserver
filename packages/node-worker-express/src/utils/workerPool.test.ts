import WorkerPool from './workerPool';
import type { WorkerLease } from './workerPool';

jest.mock('@koeroesi86/node-worker', () => {
  const { EventEmitter } = require('events');

  class FakeWorker {
    static instances: FakeWorker[] = [];
    readonly instance = Object.assign(new EventEmitter(), { exitCode: null as number | null });
    readonly terminate = jest.fn(() => this.exit(0));

    constructor(readonly command: string, readonly options: unknown) {
      FakeWorker.instances.push(this);
    }

    addEventListener = (event: string, listener: (...args: unknown[]) => unknown) => this.instance.on(event, listener);
    addEventListenerOnce = (event: string, listener: (...args: unknown[]) => unknown) => this.instance.once(event, listener);
    receive = (message: unknown) => this.instance.emit('message', message);
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

const createPool = (params = {}) => new WorkerPool({ idleCheckTimeout: 1, acquireTimeout: 50, ...params });
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

  it('never takes the last worker of a path away', async () => {
    const pool = createPool({ overallLimit: 2 });
    (await acquireAll(pool, pathA, 1, 1))[0].release();
    (await acquireAll(pool, pathB, 1, 1))[0].release();

    await expect(pool.acquire('/root/c/exampleWorker.js', {}, 1)).rejects.toThrow(/No worker became available/);
    expect(pool.getWorkerCount()).toBe(2);
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

      expect(FakeWorker.instances[0].options).toEqual({ env: { FROM: 'factory' } });
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
});
