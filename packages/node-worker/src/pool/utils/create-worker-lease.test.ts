import type Worker from '../../index';
import createWorkerRegistry from './create-worker-registry';
import type { Channel } from './createChannel';
import type { WorkerInputEvent } from '../types';
import createWorkerLease from './create-worker-lease';

const setup = () => {
  const send = jest.fn();
  const registry = createWorkerRegistry<Worker, Channel<WorkerInputEvent>>();
  // only what the lease touches of a worker
  const instance = { connected: true, send: jest.fn() };
  const worker = { instance } as never as Worker;
  const entry = { workerPath: 'a.js', id: '1', lastUsed: 0 };
  registry.add(worker, entry, { send });
  const onReleased = jest.fn();
  const onKill = jest.fn();
  const lease = createWorkerLease({ worker, registry, onReleased, onKill });

  return { registry, worker, instance, entry, send, onReleased, onKill, lease };
};

describe('createWorkerLease', () => {
  it('counts as load of the worker right away', () => {
    const { registry, worker } = setup();

    expect(registry.getLoad(worker)).toBe(1);
  });

  it('sends through the channel of the worker', () => {
    const { lease, send } = setup();

    lease.send({ requestId: 'r' } as never);

    expect(send).toHaveBeenCalledWith({ requestId: 'r' });
  });

  it('routes the messages of the request to the subscriber', () => {
    const { lease, registry } = setup();
    const onMessage = jest.fn();

    lease.subscribe('r', onMessage, jest.fn());
    registry.getSubscription('r')?.onMessage?.({ requestId: 'r' } as never);

    expect(onMessage).toHaveBeenCalledWith({ requestId: 'r' });
  });

  it('frees the worker and tells when released, also when released twice', () => {
    const { lease, registry, worker, entry, onReleased } = setup();
    lease.subscribe('r', jest.fn(), jest.fn());

    lease.release();
    lease.release();

    expect([registry.getLoad(worker), registry.getSubscription('r'), entry.lastUsed > 0, onReleased.mock.calls.length]).toEqual([0, undefined, true, 2]);
  });

  it('rejects a hand off when the worker has no IPC channel', async () => {
    const { lease, instance } = setup();
    instance.connected = false;

    await expect(lease.handOff({} as never, {} as never)).rejects.toThrow('The worker has no IPC channel.');
  });

  it('resolves a hand off once the worker took the socket', async () => {
    const { lease, instance } = setup();
    instance.send.mockImplementation((_message, _socket, callback) => callback());

    await expect(lease.handOff({} as never, {} as never)).resolves.toBeUndefined();
  });
});
