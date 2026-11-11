import { EventEmitter } from 'events';
import type { Response } from 'express';
import createLeaseAcquirer from './create-lease-acquirer';

type Acquire = Parameters<typeof createLeaseAcquirer>[0]['acquire'];

const fakeAcquire = (impl: Acquire = async () => 'lease' as never) => jest.fn<ReturnType<Acquire>, Parameters<Acquire>>(impl);

const setup = (acquire = fakeAcquire()) => {
  const workerOptions = () => ({});
  const staticWorkerOptions = { cwd: '/static' };
  const response = new EventEmitter() as Response;
  const acquireLease = createLeaseAcquirer({
    acquire,
    staticWorker: '/static.js',
    workerOptions,
    staticWorkerOptions,
    getLimitPerPath: (indexPath) => indexPath.length,
  });

  return { acquire, workerOptions, staticWorkerOptions, response, acquireLease };
};

describe('createLeaseAcquirer', () => {
  it('gets a worker for the worker file of the path, with the limit of the path', async () => {
    const { acquire, workerOptions, response, acquireLease } = setup();

    await expect(acquireLease(response, '/a.js', true)).resolves.toBe('lease');

    expect(acquire).toHaveBeenCalledWith('/a.js', workerOptions, 5, expect.any(AbortSignal));
  });

  it('gets the static worker for a path without a worker, still with the limit of the path', async () => {
    const { acquire, staticWorkerOptions, response, acquireLease } = setup();

    await acquireLease(response, '/a/file.txt', false);

    expect(acquire).toHaveBeenCalledWith('/static.js', staticWorkerOptions, 11, expect.any(AbortSignal));
  });

  it('aborts the wait when the client goes away', async () => {
    let release: (lease: never) => void = () => undefined;
    const acquire = fakeAcquire(() => new Promise<never>((resolve) => (release = resolve)));
    const { response, acquireLease } = setup(acquire);

    const pending = acquireLease(response, '/a.js', true);
    const signal = acquire.mock.calls[0][3];
    expect(signal.aborted).toBe(false);
    response.emit('close');
    release('lease' as never);
    await pending;

    expect(signal.aborted).toBe(true);
  });

  it('stops listening for the close once it has a worker', async () => {
    const { response, acquireLease } = setup();

    await acquireLease(response, '/a.js', true);

    expect(response.listenerCount('close')).toBe(0);
  });

  it('stops listening for the close when it fails', async () => {
    const { response, acquireLease } = setup(fakeAcquire(() => Promise.reject(new Error('no worker'))));

    await expect(acquireLease(response, '/a.js', true)).rejects.toThrow('no worker');

    expect(response.listenerCount('close')).toBe(0);
  });
});
