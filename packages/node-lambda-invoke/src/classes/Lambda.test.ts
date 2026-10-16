import { EventEmitter } from 'events';
import Lambda from './Lambda';
import type Worker from './Worker';
import ResponseEvent from './ResponseEvent';
import type RequestEvent from './RequestEvent';
import type { Storage, StorageDriverConstructor } from '../types';

const request = { httpMethod: 'GET' } as RequestEvent;
const response = Object.assign(new ResponseEvent(), { statusCode: 200, body: 'ok' });
const settled = () => new Promise((resolve) => setImmediate(resolve));

/** a worker that is an emitter, so that no process is needed */
const createWorker = (exited = false) => {
  const emitter = new EventEmitter();
  const worker = {
    instance: exited ? undefined : {},
    stdout: undefined,
    stderr: undefined,
    postMessage: jest.fn(),
    terminate: jest.fn(),
    addEventListener: (event: string, listener: () => void) => emitter.on(event, listener),
    addEventListenerOnce: (event: string, listener: () => void) => emitter.once(event, listener),
    removeEventListener: (event: string, listener: () => void) => emitter.off(event, listener),
  };
  return { worker: worker as unknown as Worker, mocks: worker, emit: emitter.emit.bind(emitter), listeners: (event: string) => emitter.listenerCount(event) };
};

const createDriver = (overrides: Partial<Storage> = {}) => {
  const storage = {
    setRequest: jest.fn().mockResolvedValue(undefined),
    getResponse: jest.fn().mockResolvedValue(response),
    destroy: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const StorageDriver = jest.fn(() => storage);
  return { storage, StorageDriver: StorageDriver as unknown as StorageDriverConstructor, calls: StorageDriver.mock.calls };
};

const create = (storageOverrides: Partial<Storage> = {}, exited = false) => {
  const logger = jest.fn();
  const driver = createDriver(storageOverrides);
  const process = createWorker(exited);
  const lambda = new Lambda(process.worker, { StorageDriver: driver.StorageDriver, storageFolder: '/storage', logger });
  return { lambda, logger, ...driver, ...process };
};

describe('Lambda', () => {
  it('starts free, not retiring, and tells whether its process is still there', () => {
    expect(create().lambda).toMatchObject({ busy: false, retiring: false, running: true, storageFolder: '/storage' });
    expect(create({}, true).lambda.running).toBe(false);
  });

  it('is taken by reserve, retired by retire, and gives itself back by telling the pool', () => {
    const { lambda } = create();
    const onFree = jest.fn();
    lambda.onFree(onFree);

    lambda.reserve();
    lambda.retire();
    expect(lambda).toMatchObject({ busy: true, retiring: true });
    expect(onFree).not.toHaveBeenCalled();

    lambda.markFree();
    expect(lambda.busy).toBe(false);
    expect(onFree).toHaveBeenCalledTimes(1);
  });

  describe('invoke', () => {
    it('stores the request, asks the process for it, and answers with the response once the process sent it', async () => {
      const { lambda, storage, calls, mocks, emit } = create();
      const callback = jest.fn();
      const onFree = jest.fn();
      lambda.onFree(onFree);

      lambda.invoke('abc', request, callback, 1000);
      await settled();

      expect(calls[0].slice(0, 3)).toEqual(['abc', mocks, '/storage']);
      expect(storage.setRequest).toHaveBeenCalledWith(request);
      expect(mocks.postMessage).toHaveBeenCalledWith({ type: 'LAMBDA_EVENT_REQUEST', id: 'abc', deadline: expect.any(Number) });
      expect(lambda.busy).toBe(true);

      emit('message', { type: 'LAMBDA_EVENT_RESPONSE', id: 'abc' });
      await settled();

      expect(callback).toHaveBeenCalledWith(response);
      expect(storage.destroy).toHaveBeenCalledTimes(1);
      expect(lambda.busy).toBe(false);
      expect(onFree).toHaveBeenCalledTimes(1);
    });

    it('ignores the response of another request and of other messages', async () => {
      const { lambda, callback = jest.fn(), emit } = { ...create(), callback: jest.fn() };

      lambda.invoke('abc', request, callback);
      await settled();
      emit('message', { type: 'LAMBDA_EVENT_RESPONSE', id: 'other' });
      emit('message', { type: 'LAMBDA_EVENT_STARTED' });
      await settled();

      expect(callback).not.toHaveBeenCalled();
      expect(lambda.busy).toBe(true);
    });

    it('stops listening once it answered, so that the next request starts clean', async () => {
      const { lambda, emit, listeners } = create();

      lambda.invoke('abc', request);
      await settled();
      expect(listeners('message')).toBe(1);

      emit('message', { type: 'LAMBDA_EVENT_RESPONSE', id: 'abc' });
      await settled();

      expect(listeners('message')).toBe(0);
    });

    it('answers a response that cannot be read with the failure, and still frees the lambda', async () => {
      const { lambda, logger, storage, emit } = create({ getResponse: jest.fn().mockRejectedValue(new Error('unreadable')) });
      const callback = jest.fn();
      const onFree = jest.fn();
      lambda.onFree(onFree);

      lambda.invoke('abc', request, callback);
      await settled();
      emit('message', { type: 'LAMBDA_EVENT_RESPONSE', id: 'abc' });
      await settled();

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500, body: 'Something went wrong.' }));
      expect(logger).toHaveBeenCalledWith(new Error('unreadable'));
      expect(storage.destroy).toHaveBeenCalledTimes(1);
      expect(onFree).toHaveBeenCalledTimes(1);
    });

    it('gives the lambda back and answers with the failure when the request could not be stored', async () => {
      const { lambda, logger, mocks } = create({ setRequest: jest.fn().mockRejectedValue(new Error('disk full')) });
      const callback = jest.fn();
      const onFree = jest.fn();
      lambda.onFree(onFree);
      lambda.reserve();

      lambda.invoke('abc', request, callback);
      await settled();

      expect(mocks.postMessage).not.toHaveBeenCalled();
      expect(lambda.busy).toBe(false);
      expect(onFree).toHaveBeenCalledTimes(1);
      expect(logger).toHaveBeenCalledWith(new Error('disk full'));
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });
  });

  it('hands the process what is asked of it', () => {
    const { lambda, mocks } = create();
    const listener = jest.fn();

    lambda.addEventListener('message', listener);
    lambda.postMessage({ a: 1 });
    lambda.terminate('SIGKILL');

    expect(mocks.postMessage).toHaveBeenCalledWith({ a: 1 }, expect.any(Function));
    expect(mocks.terminate).toHaveBeenCalledWith('SIGKILL');
  });
});
