import { EventEmitter } from 'events';
import IPCStorage from './IPCStorage';
import type RequestEvent from './RequestEvent';
import type { StorageInstance } from '../types';

/** the process the storage is attached to, the other side answers through `reply` */
const createEndpoint = () => {
  const emitter = new EventEmitter();
  const send = jest.fn();
  const instance = Object.assign(emitter, { send }) as unknown as StorageInstance;
  return { emitter, send, instance };
};

const request = { path: '/a', httpMethod: 'GET' } as RequestEvent;

describe('IPCStorage', () => {
  beforeEach(() => IPCStorage.start());

  it('names its keys by the id', () => {
    const storage = new IPCStorage('abc', createEndpoint().instance);

    expect(storage.requestKey).toBe('request-abc');
    expect(storage.responseKey).toBe('response-abc');
  });

  it('sends a request over, and finishes when the other side confirms it', async () => {
    const { emitter, send, instance } = createEndpoint();
    const done = new IPCStorage('abc', instance).setRequest(request);

    expect(send).toHaveBeenCalledWith({ type: 'GW_SET_REQUEST', id: 'abc', payload: request });

    emitter.emit('message', { type: 'GW_SET_REQUEST_FINISHED', id: 'other' });
    emitter.emit('message', { type: 'GW_SET_REQUEST_FINISHED', id: 'abc' });

    await expect(done).resolves.toBeUndefined();
    expect(emitter.listenerCount('message')).toBe(1);
  });

  it('sends a response over, and finishes when the other side confirms it', async () => {
    const { emitter, send, instance } = createEndpoint();
    const done = new IPCStorage('abc', instance).setResponse({ statusCode: 200 });

    expect(send).toHaveBeenCalledWith({ type: 'GW_SET_RESONSE', id: 'abc', payload: { statusCode: 200 } });

    emitter.emit('message', { type: 'GW_SET_RESONSE_FINISHED', id: 'abc' });

    await expect(done).resolves.toBeUndefined();
  });

  it('gives back a response it has stored without asking', async () => {
    const { send, instance } = createEndpoint();
    const storage = new IPCStorage('abc', instance);
    storage.setResponse({ statusCode: 202 });
    send.mockClear();

    await expect(storage.getResponse()).resolves.toEqual({ statusCode: 202 });
    expect(send).not.toHaveBeenCalled();
  });

  it('asks the other side for a response it does not have, and waits for the answer', async () => {
    const { emitter, send, instance } = createEndpoint();
    const done = new IPCStorage('abc', instance).getResponse();

    expect(send).toHaveBeenCalledWith({ type: 'GW_GET_RESONSE', id: 'abc' });

    emitter.emit('message', { type: 'GW_SET_RESONSE', id: 'abc', payload: { statusCode: 204 } });

    await expect(done).resolves.toEqual({ statusCode: 204 });
  });

  it('asks the other side for a request it does not have, and waits for the answer', async () => {
    const { emitter, send, instance } = createEndpoint();
    const done = new IPCStorage('abc', instance).getRequest();

    expect(send).toHaveBeenCalledWith({ type: 'GW_GET_REQUEST', id: 'abc' });

    emitter.emit('message', { type: 'GW_SET_REQUEST', id: 'abc', payload: request });

    await expect(done).resolves.toBe(request);
  });

  it('keeps what the other side sets while attached as the executor, and answers for it', async () => {
    const { emitter, instance } = createEndpoint();
    const send = jest.spyOn(process, 'send').mockImplementation(() => true);
    const storage = new IPCStorage('abc', instance);

    try {
      emitter.emit('message', { type: 'GW_SET_REQUEST', id: 'abc', payload: request });

      expect(send).toHaveBeenCalledWith({ type: 'GW_SET_REQUEST_FINISHED', id: 'abc' });
      await expect(storage.getRequest()).resolves.toBe(request);
    } finally {
      send.mockRestore();
    }
  });

  it('ignores messages that are not its own', async () => {
    const { emitter, instance } = createEndpoint();
    const storage = new IPCStorage('abc', instance);
    const done = storage.getResponse();

    emitter.emit('message', 'text');
    emitter.emit('message', null);
    emitter.emit('message', { type: 'GW_SET_RESONSE', id: 'other', payload: { statusCode: 500 } });
    emitter.emit('message', { type: 'GW_SET_RESONSE', id: 'abc', payload: { statusCode: 200 } });

    await expect(done).resolves.toEqual({ statusCode: 200 });
  });

  it('forgets what it kept, and stops listening, when destroyed', async () => {
    const { emitter, send, instance } = createEndpoint();
    const storage = new IPCStorage('abc', instance);
    storage.setResponse({ statusCode: 200 });
    await storage.destroy();
    send.mockClear();
    storage.getResponse();

    expect(send).toHaveBeenCalledWith({ type: 'GW_GET_RESONSE', id: 'abc' });
    expect(emitter.listenerCount('message')).toBe(2);
  });

  it('forgets everything when it starts', async () => {
    const { send, instance } = createEndpoint();
    new IPCStorage('abc', instance).setResponse({ statusCode: 200 });
    IPCStorage.start();
    send.mockClear();
    new IPCStorage('abc', instance).getResponse();

    expect(send).toHaveBeenCalledWith({ type: 'GW_GET_RESONSE', id: 'abc' });
  });
});
