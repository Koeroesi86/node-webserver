import createWorkerRegistry from './create-worker-registry';
import type { LeaseState } from './create-worker-registry';

interface FakeWorker {
  name: string;
}

const entryOf = (workerPath: string, id: string) => ({ workerPath, id, lastUsed: 0 });

const setup = () => {
  const registry = createWorkerRegistry<FakeWorker, string>();
  const first = { name: 'first' };
  const second = { name: 'second' };
  registry.add(first, entryOf('a.js', '1'), 'channel-1');
  registry.add(second, entryOf('a.js', '2'), 'channel-2');

  return { registry, first, second };
};

describe('createWorkerRegistry', () => {
  it('counts the workers per path and in all', () => {
    const { registry } = setup();
    registry.add({ name: 'other' }, entryOf('b.js', '3'), 'channel-3');

    expect([registry.getWorkerCountForPath('a.js'), registry.getWorkerCountForPath('c.js'), registry.getWorkerCount()]).toEqual([2, 0, 3]);
  });

  it('counts a lease as the load of its worker until it is removed', () => {
    const { registry, first } = setup();
    const state: LeaseState = {};

    registry.addLease(first, state);
    const loaded = registry.getLoad(first);
    registry.removeLease(first, state);

    expect([loaded, registry.getLoad(first), registry.getActive()]).toEqual([1, 0, 0]);
  });

  it('finds the lease of a request by its id and drops it with the lease', () => {
    const { registry, first } = setup();
    const state: LeaseState = {};
    registry.addLease(first, state);
    registry.subscribe(state, 'request');

    const found = registry.getSubscription('request');
    registry.removeLease(first, state);

    expect([found, registry.getSubscription('request')]).toEqual([state, undefined]);
  });

  it('keeps a subscription that a later request took over the id of', () => {
    const { registry, first } = setup();
    const old: LeaseState = {};
    const current: LeaseState = {};
    registry.addLease(first, old);
    registry.addLease(first, current);
    registry.subscribe(old, 'request');
    registry.subscribe(current, 'request');

    registry.removeLease(first, old);

    expect(registry.getSubscription('request')).toBe(current);
  });

  it('takes a worker out of its path with unlist but keeps its entry, channel and leases', () => {
    const { registry, first } = setup();
    const state: LeaseState = {};
    registry.addLease(first, state);

    registry.unlist(first);

    expect([registry.getWorkersForPath('a.js').includes(first), registry.getEntry(first)?.id, registry.getChannel(first), registry.getLoad(first)]).toEqual([
      false,
      '1',
      'channel-1',
      1,
    ]);
  });

  it('forgets a worker everywhere on remove and returns the requests that held it', () => {
    const { registry, first } = setup();
    const state: LeaseState = {};
    registry.addLease(first, state);
    registry.subscribe(state, 'request');

    const leases = registry.remove(first);

    expect([
      leases,
      registry.getSubscription('request'),
      registry.getEntry(first),
      registry.getChannel(first),
      registry.getLoad(first),
      registry.getWorkerCount(),
    ]).toEqual([[state], undefined, undefined, undefined, 0, 1]);
  });

  it('removes a worker that was unlisted before without touching the others', () => {
    const { registry, first, second } = setup();
    registry.unlist(first);

    registry.remove(first);

    expect(registry.getWorkersForPath('a.js')).toEqual([second]);
  });

  it('forgets a path and its turns once its last worker is gone', () => {
    const { registry, first, second } = setup();
    registry.nextCursor('a.js');
    registry.remove(first);
    registry.remove(second);

    expect([registry.getPathStats(), registry.nextCursor('a.js')]).toEqual([{}, 0]);
  });

  it('hands out the turns of a path in order', () => {
    const { registry } = setup();

    expect([registry.nextCursor('a.js'), registry.nextCursor('a.js'), registry.nextCursor('b.js')]).toEqual([0, 1, 0]);
  });

  it('reports the workers and the requests per path', () => {
    const { registry, first } = setup();
    registry.addLease(first, {});

    expect(registry.getPathStats()).toEqual({ 'a.js': { workers: 2, active: 1 } });
  });
});
