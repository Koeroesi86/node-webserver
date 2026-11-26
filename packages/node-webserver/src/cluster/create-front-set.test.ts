import createFrontSet from './create-front-set';
import createMockLogger from '../observability/mock-logger.test-helper';
import { createFakeFork } from './fake-front.test-helper';
import { createPlan } from './server-plan.test-helper';
import type { FrontSetOptions } from '../types';

describe('createFrontSet', () => {
  const logger = createMockLogger();
  const watch = jest.fn(() => () => {});
  const onStale = jest.fn();
  const onRecount = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  const create = (change: Parameters<typeof createPlan>[0] = {}, extra: Partial<FrontSetOptions> = {}) => {
    const { fork, fronts } = createFakeFork();
    const plan = createPlan(change);
    return { fronts, set: createFrontSet({ plan, fork, logger, watch, onStale, onRecount, ...extra }) };
  };
  const ready = {
    nodeWebserver: 'ready' as const,
    release: createPlan().release,
    files: ['a.js'],
    fingerprint: 'a',
    singleFrontOnly: false,
  };
  const started = async (change: Parameters<typeof createPlan>[0] = {}) => {
    const created = create(change);
    const start = created.set.start();
    created.fronts.forEach((front) => front.say(ready));
    await start;
    return created;
  };

  it('starts the fronts of the plan, watches their files and reloads them together', async () => {
    const { set, fronts } = await started();

    set.reload();

    expect(fronts).toHaveLength(2);
    expect(watch).toHaveBeenCalled();
    expect(fronts.map(({ sent }) => sent)).toEqual([[{ nodeWebserver: 'prepare', round: 1 }], [{ nodeWebserver: 'prepare', round: 1 }]]);
  });

  it('watches no file for a configuration that does not ask for it', async () => {
    await started({ settings: { reloadOnSighup: false, shutdownTimeout: 1, watchServers: false } });

    expect(watch).not.toHaveBeenCalled();
  });

  it('tells when the servers need another number of fronts, and when a front cannot replace another one', async () => {
    jest.useFakeTimers();
    const { set, fronts } = await started();
    set.reload();
    fronts[0].say({ nodeWebserver: 'prepare-failed', round: 1, reason: 'count', recount: true });
    fronts[1].say({ nodeWebserver: 'prepare-failed', round: 1, reason: 'count', recount: true });
    fronts[0].exit(1);
    jest.advanceTimersByTime(0);
    fronts[2].say({ nodeWebserver: 'stale', reason: 'another version' });
    fronts[2].exit(0);
    jest.useRealTimers();

    expect(onRecount).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it('stops the fronts and the reloads', async () => {
    const { set, fronts } = await started();

    const stopped = set.stop({ nodeWebserver: 'stop' }, 1000);
    set.reload();
    fronts.forEach((front) => front.exit(0));
    await stopped;

    expect(fronts.map(({ sent }) => sent)).toEqual([[{ nodeWebserver: 'stop' }], [{ nodeWebserver: 'stop' }]]);
    expect(set.isEmpty()).toBe(true);
  });

  it('says whether a server of its fronts must not run twice', async () => {
    const { set, fronts } = await started();
    expect(set.isSingleFrontOnly()).toBe(false);

    fronts[1].say({ nodeWebserver: 'files', files: [], singleFrontOnly: true });

    expect(set.isSingleFrontOnly()).toBe(true);
  });

  it('rejects when a front does not start', async () => {
    const { set, fronts } = create();
    const start = expect(set.start()).rejects.toThrow('did not start');

    fronts[0].exit(1);
    fronts[1].exit(0);

    await start;
  });
});
