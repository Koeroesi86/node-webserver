import type { EventEmitter } from 'events';
import LambdaPool, { LambdaRequestAbandonedError, LambdaUnavailableError } from './LambdaPool';
import { DRAIN_AFTER, STOP_GRACE } from '../constants';
import type Lambda from './Lambda';

/** lambdas that start, or fail to, when the test says so, instead of processes */
jest.mock('./Lambda', () => {
  const { EventEmitter: Emitter } = require('events');

  class FakeLambda extends Emitter {
    static instances: FakeLambda[] = [];
    static exitOnStart = false;
    busy = false;
    createdAt?: number;
    onFree = () => {};
    stdout = undefined;
    stderr = undefined;

    constructor() {
      super();
      FakeLambda.instances.push(this);
      queueMicrotask(() => (FakeLambda.exitOnStart ? this.emit('close', 1) : this.emit('message', { type: 'LAMBDA_EVENT_STARTED' })));
    }

    addEventListener(event: string, listener: () => void) {
      this.on(event, listener);
    }

    addEventListenerOnce(event: string, listener: () => void) {
      this.once(event, listener);
    }

    removeEventListener(event: string, listener: () => void) {
      this.off(event, listener);
    }

    terminate = jest.fn();
  }

  return { __esModule: true, default: FakeLambda };
});

interface FakeLambdas {
  default: { instances: (EventEmitter & { terminate: jest.Mock; retiring: boolean })[]; exitOnStart: boolean };
}

const fake = () => jest.requireMock<FakeLambdas>('./Lambda').default;

const settled = () => new Promise((resolve) => setImmediate(resolve));

/** the state of a promise, without waiting for it */
const track = <T>(promise: Promise<T>) => {
  const state: { value?: T; error?: unknown; done: boolean } = { done: false };
  promise.then(
    (value) => Object.assign(state, { value, done: true }),
    (error) => Object.assign(state, { error, done: true })
  );
  return state;
};

describe('LambdaPool', () => {
  const create = (options: Partial<ConstructorParameters<typeof LambdaPool>[0]> = {}) =>
    new LambdaPool({ lambdaPath: '/lambdas/a.js', handlerKey: 'handler', limit: 1, communication: { type: 'ipc' }, ...options });

  /** a free lambda is handed over the way the invocation of a request lets go of it */
  const free = (lambda: Lambda) => {
    lambda.busy = false;
    lambda.onFree();
  };

  beforeEach(() => {
    // the timers are the ones of the pool, the fake lambdas start on microtasks
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    fake().instances.length = 0;
    fake().exitOnStart = false;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts a lambda while the limit allows, and makes the next request wait', async () => {
    const pool = create();
    const first = await pool.getLambda();
    const second = track(pool.getLambda());
    await settled();

    expect(first.busy).toBe(true);
    expect(second.done).toBe(false);
    expect(pool).toMatchObject({ count: 1, waiting: 1 });
  });

  it('hands a lambda that became free to the first request in line, at once and without a timer', async () => {
    const pool = create();
    const first = await pool.getLambda();
    const second = track(pool.getLambda());
    const third = track(pool.getLambda());
    await settled();

    free(first);
    await settled();

    // no timer was advanced: nothing polls
    expect(second.value).toBe(first);
    expect(third.done).toBe(false);

    free(first);
    await settled();

    expect(third.value).toBe(first);
    expect(pool.waiting).toBe(0);
  });

  it('answers a request that waited longer than the acquire timeout with an error, and takes it out of the line', async () => {
    const pool = create({ acquireTimeout: 1000 });
    const first = await pool.getLambda();
    const second = track(pool.getLambda());

    jest.advanceTimersByTime(1000);
    await settled();

    expect(second.error).toBeInstanceOf(LambdaUnavailableError);
    expect(pool.waiting).toBe(0);

    free(first);
    await settled();

    expect(first.busy).toBe(false);
  });

  it('takes a request out of the line when its signal is aborted, and counts it', async () => {
    const pool = create();
    const first = await pool.getLambda();
    const leaving = new AbortController();
    const abandoned = track(pool.getLambda(leaving.signal));
    const next = track(pool.getLambda());
    await settled();

    leaving.abort();
    await settled();

    expect(abandoned.error).toBeInstanceOf(LambdaRequestAbandonedError);
    expect(pool).toMatchObject({ waiting: 1, abandoned: 1 });

    free(first);
    await settled();

    expect(next.value).toBe(first);
  });

  it('does not queue a request whose signal was aborted already', async () => {
    const pool = create();
    const signal = AbortSignal.abort();

    await expect(pool.getLambda(signal)).rejects.toBeInstanceOf(LambdaRequestAbandonedError);
    expect(pool).toMatchObject({ count: 0, waiting: 0, abandoned: 1 });
  });

  it('gives the place of a lambda that exited to the first request in line', async () => {
    const pool = create();
    await pool.getLambda();
    const waiting = track(pool.getLambda());
    await settled();

    fake().instances[0].emit('close', 1);
    await settled();

    expect(fake().instances).toHaveLength(2);
    expect(waiting.value).toBe(fake().instances[1]);
    expect(pool.count).toBe(1);
  });

  it('gives the place back when a lambda fails to start', async () => {
    const pool = create();
    fake().exitOnStart = true;

    await expect(pool.getLambda()).rejects.toThrow('did not start');
    expect(pool.count).toBe(0);

    fake().exitOnStart = false;

    expect((await pool.getLambda()).busy).toBe(true);
  });

  it('hands a lambda on that was taken but not used', async () => {
    const pool = create();
    const first = await pool.getLambda();
    const second = track(pool.getLambda());
    await settled();

    pool.release(first);
    await settled();

    expect(second.value).toBe(first);
  });

  it('never has more lambdas than the limit while requests keep coming', async () => {
    const pool = create({ limit: 2 });
    const requests = Array.from({ length: 6 }, () => track(pool.getLambda()));
    await settled();

    expect(requests.filter(({ done }) => done)).toHaveLength(2);
    expect(pool.count).toBe(2);

    requests.forEach(({ value }) => value && free(value));
    await settled();

    expect(requests.filter(({ done }) => done)).toHaveLength(4);
    expect(fake().instances).toHaveLength(2);
  });

  describe('lifespan', () => {
    it('stops a lambda that is idle when it has had its time, and does not hand it out any more', async () => {
      const pool = create({ limit: 0 });
      const first = await pool.getLambda();
      free(first);

      jest.advanceTimersByTime(DRAIN_AFTER);

      expect(fake().instances[0].terminate).toHaveBeenCalledWith('SIGTERM');
      expect(fake().instances[0].retiring).toBe(true);

      const next = await pool.getLambda();

      expect(next).not.toBe(first);
    });

    it('lets a request that runs finish, and stops the lambda when it is free', async () => {
      const pool = create();
      const first = await pool.getLambda();

      jest.advanceTimersByTime(DRAIN_AFTER);

      expect(fake().instances[0].terminate).not.toHaveBeenCalled();

      free(first);

      expect(fake().instances[0].terminate).toHaveBeenCalledWith('SIGTERM');
    });

    it('starts a new lambda for the request that waits once the old one is gone', async () => {
      const pool = create();
      const first = await pool.getLambda();
      free(first);
      jest.advanceTimersByTime(DRAIN_AFTER);
      const waiting = track(pool.getLambda());
      await settled();

      // the old one still counts, it is a process until it exits
      expect(waiting.done).toBe(false);

      fake().instances[0].emit('close', 0);
      await settled();

      expect(waiting.value).toBe(fake().instances[1]);
    });

    it('kills a lambda that does not stop when it is asked to', async () => {
      const pool = create();
      free(await pool.getLambda());

      jest.advanceTimersByTime(DRAIN_AFTER);
      jest.advanceTimersByTime(STOP_GRACE);

      expect(fake().instances[0].terminate.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    });

    it('does not touch a lambda that exited before its time', async () => {
      const pool = create();
      free(await pool.getLambda());
      fake().instances[0].emit('close', 0);

      jest.advanceTimersByTime(DRAIN_AFTER + STOP_GRACE);

      expect(fake().instances[0].terminate).not.toHaveBeenCalled();
    });
  });
});
