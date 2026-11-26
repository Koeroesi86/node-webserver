import createFrontsManager from './create-fronts-manager';
import createMockLogger from '../observability/mock-logger.test-helper';
import { createPlan } from './server-plan.test-helper';
import { FRONT_STOP_MARGIN, RELOAD_DEBOUNCE } from '../constants';
import type { ServerPlan } from '../types';

const settle = async () => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
};

describe('createFrontsManager', () => {
  const logger = createMockLogger();
  const restart = jest.fn();
  const onLost = jest.fn();
  const stopWatching = jest.fn();
  const requestPlan = jest.fn<Promise<ServerPlan>, []>();
  let changeFile = () => {};
  let files: string | undefined;

  const createSet = () => ({
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    reload: jest.fn(),
    isEmpty: jest.fn(() => false),
    isSingleFrontOnly: jest.fn(() => false),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    files = 'a';
    requestPlan.mockImplementation(async () => createPlan({ filesFingerprint: files }));
  });

  afterEach(() => jest.useRealTimers());

  const create = (options: Partial<Parameters<typeof createFrontsManager>[0]> = {}) => {
    const sets: Array<ReturnType<typeof createSet>> = [];
    const events: Array<{ onStale: () => void; onRecount: () => void }> = [];
    const prepared: Array<ReturnType<typeof createSet>> = [];
    const watch = jest.fn((_files: string[], onChange: () => void) => {
      changeFile = onChange;
      return stopWatching;
    });
    const manager = createFrontsManager({
      logger,
      version: '1.0.0',
      createSet: (_plan, given) => {
        const set = prepared.shift() ?? createSet();
        sets.push(set);
        events.push(given);
        return set;
      },
      requestPlan,
      watch,
      fingerprint: () => files,
      restart,
      onLost,
      ...options,
    });
    return { manager, sets, events, prepared, watch };
  };

  const started = async (options: Parameters<typeof create>[0] = {}, plan = createPlan()) => {
    const created = create(options);
    await created.manager.start(plan);
    return created;
  };

  it('starts the fronts of the plan, and watches the files of the configuration', async () => {
    const { sets, watch, manager } = await started();

    expect(sets[0].start).toHaveBeenCalled();
    expect(watch).toHaveBeenCalledWith(['configuration.js'], expect.any(Function));
    expect(manager.getPlan()).toMatchObject({ frontCount: 2 });
  });

  it('rejects when the first fronts do not start', async () => {
    const { manager, prepared } = create();
    prepared.push({ ...createSet(), start: jest.fn(() => Promise.reject(new Error('port in use'))) });

    await expect(manager.start(createPlan())).rejects.toThrow('port in use');
  });

  it.each([
    ['watchServers is off', createPlan({ settings: { reloadOnSighup: false, shutdownTimeout: 1, watchServers: false } })],
    ['no file of it is known', createPlan({ files: [], filesFingerprint: undefined })],
  ])('watches no file of the configuration when %s', async (_, plan) => {
    const { watch } = await started({}, plan);

    expect(watch).not.toHaveBeenCalled();
  });

  it('applies a change that came while the first fronts started', async () => {
    files = 'changed';
    const { sets } = await started();
    await settle();

    expect(sets).toHaveLength(2);
  });

  it('starts new fronts for a change of a file, and stops the old ones once the new ones serve', async () => {
    jest.useFakeTimers();
    const { sets } = await started();
    files = 'b';

    changeFile();
    changeFile();
    jest.advanceTimersByTime(RELOAD_DEBOUNCE);
    await settle();

    expect(sets).toHaveLength(2);
    expect(sets[0].stop).toHaveBeenCalledWith({ nodeWebserver: 'stop' }, 100 + FRONT_STOP_MARGIN);
    expect(sets[1].stop).not.toHaveBeenCalled();
    expect(requestPlan).toHaveBeenCalledTimes(1);
  });

  it('keeps the old fronts when the new ones do not start', async () => {
    const { manager, sets, prepared } = await started();
    files = 'b';
    prepared.push({ ...createSet(), start: jest.fn(() => Promise.reject(new Error('port in use'))) });

    manager.reload();
    await settle();

    expect(sets[0].stop).not.toHaveBeenCalled();
    expect(sets[0].reload).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('was not applied'), expect.any(Error));
  });

  it('loads the servers again for a reload without a change of the configuration', async () => {
    const { manager, sets } = await started();

    manager.reload();
    await settle();

    expect(sets).toHaveLength(1);
    expect(sets[0].reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the fronts for a configuration with errors, says them, and watches the files it loads too', async () => {
    const { manager, sets, watch } = await started();
    const problems = [{ severity: 'error' as const, setting: 'portHttp', message: 'is wrong' }];
    requestPlan.mockResolvedValue(createPlan({ problems, files: ['configuration.js', 'new.js'] }));

    manager.reload();
    await settle();

    expect(sets).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('portHttp is wrong'));
    expect(watch).toHaveBeenLastCalledWith(['configuration.js', 'new.js'], expect.any(Function));
  });

  it('keeps the fronts for a configuration that cannot be loaded', async () => {
    const { manager, sets } = await started();
    requestPlan.mockRejectedValue(new Error('syntax'));

    manager.reload();
    await settle();

    expect(sets).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('could not be loaded'), expect.any(Error));
  });

  it('stops the fronts and restarts when two sets cannot run side by side', async () => {
    const { manager, sets } = await started();
    requestPlan.mockResolvedValue(createPlan({ filesFingerprint: 'b', balanced: false }));

    manager.reload();
    await settle();

    expect(sets).toHaveLength(1);
    expect(sets[0].stop).toHaveBeenCalledWith({ nodeWebserver: 'stop' }, 100 + FRONT_STOP_MARGIN);
    expect(restart).toHaveBeenCalled();
    expect(sets[0].reload).not.toHaveBeenCalled();
  });

  it('keeps the fronts and says so when nothing would start the server again', async () => {
    const { manager, sets } = await started({ restart: undefined });
    requestPlan.mockResolvedValue(createPlan({ filesFingerprint: 'b', balanced: false }));

    manager.reload();
    await settle();

    expect(sets[0].stop).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Restart the server'));
  });

  it('does not restart when a signal stops it while the fronts stop for the restart', async () => {
    const { manager, sets } = await started();
    let finish = () => {};
    sets[0].stop.mockImplementation(() => new Promise<undefined>((resolve) => (finish = () => resolve(undefined))));
    requestPlan.mockResolvedValue(createPlan({ filesFingerprint: 'b', balanced: false }));
    manager.reload();
    await settle();

    void manager.stop({ nodeWebserver: 'signal', signal: 'SIGTERM' }, 1);
    finish();
    await settle();

    expect(restart).not.toHaveBeenCalled();
  });

  it('starts new fronts when a front of the serving ones cannot be replaced, and when they need another number', async () => {
    const { sets, events } = await started();

    events[0].onStale();
    await settle();
    requestPlan.mockResolvedValue(createPlan({ frontCount: 1 }));
    events[1].onRecount();
    await settle();
    events[0].onStale();
    await settle();

    expect(sets).toHaveLength(3);
    expect(requestPlan).toHaveBeenCalledTimes(2);
  });

  it('tells when no front serves and none is started in its place', async () => {
    const { events, sets, prepared } = await started();
    sets[0].isEmpty.mockReturnValue(true);
    prepared.push({ ...createSet(), start: jest.fn(() => Promise.reject(new Error('port in use'))) });

    events[0].onStale();
    await settle();

    expect(onLost).toHaveBeenCalled();
  });

  it('looks at one change at a time, and once more for all that came meanwhile', async () => {
    const { manager } = await started();

    manager.reload();
    await Promise.resolve();
    await Promise.resolve();
    manager.reload();
    manager.reload();
    await settle();

    expect(requestPlan).toHaveBeenCalledTimes(2);
  });

  it('stops every set, also the one that starts, and applies nothing after', async () => {
    const { manager, sets, prepared } = await started();
    files = 'b';
    let finish = () => {};
    prepared.push({ ...createSet(), start: jest.fn(() => new Promise<undefined>((resolve) => (finish = () => resolve(undefined)))) });
    manager.reload();
    await settle();

    await manager.stop({ nodeWebserver: 'stop' }, 5);
    finish();
    manager.reload();
    await settle();

    expect(sets.map(({ stop }) => stop.mock.calls)).toEqual([[[{ nodeWebserver: 'stop' }, 5]], [[{ nodeWebserver: 'stop' }, 5]]]);
    expect(sets.map(({ reload }) => reload.mock.calls.length)).toEqual([0, 0]);
    expect(stopWatching).toHaveBeenCalled();
  });
});
