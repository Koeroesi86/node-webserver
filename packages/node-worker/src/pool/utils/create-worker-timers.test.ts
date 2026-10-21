import type Worker from '../../index';
import createWorkerReadiness from './create-worker-readiness';
import type { WorkerEntry } from './create-worker-registry';
import createWorkerTimers from './create-worker-timers';
import WorkerStartError from './workerStartError';

const worker = { terminate: jest.fn() } as unknown as Worker;
const entry = (readiness = createWorkerReadiness()): WorkerEntry => ({ workerPath: '/a.js', id: '1', lastUsed: 0, readiness });
const create = (params: Partial<Parameters<typeof createWorkerTimers>[0]> = {}) =>
  createWorkerTimers({ startTimeout: 100, maxAge: 200, idleTimeout: 300, onAge: jest.fn(), onIdle: jest.fn(), ...params });

describe('createWorkerTimers', () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('start', () => {
    it('kills a worker that is not ready in time and fails what waits for it', async () => {
      const current = entry();
      const rejection = current.readiness?.promise.catch((error) => error);

      create().start(worker, current);
      jest.advanceTimersByTime(100);

      expect(worker.terminate).toHaveBeenCalledWith('SIGKILL');
      await expect(rejection).resolves.toBeInstanceOf(WorkerStartError);
    });

    it('starts nothing for a worker without a handshake', () => {
      expect(create({ startTimeout: 0 }).start(worker, { ...entry(), readiness: undefined })).toBeUndefined();
    });
  });

  it('calls back for the age of a worker', () => {
    const onAge = jest.fn();

    create({ onAge }).age(worker);
    jest.advanceTimersByTime(200);

    expect(onAge).toHaveBeenCalledWith(worker);
  });

  it('calls back for the idle time of a worker', () => {
    const onIdle = jest.fn();

    create({ onIdle }).idle(worker);
    jest.advanceTimersByTime(300);

    expect(onIdle).toHaveBeenCalledWith(worker);
  });

  it('starts no timer for a limit of 0', () => {
    const timers = create({ maxAge: 0, idleTimeout: 0 });

    expect(timers.age(worker)).toBeUndefined();
    expect(timers.idle(worker)).toBeUndefined();
  });
});
