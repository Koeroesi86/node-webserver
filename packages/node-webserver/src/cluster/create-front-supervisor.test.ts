import createFrontSupervisor from './create-front-supervisor';
import createMockLogger from '../observability/mock-logger.test-helper';
import { createFakeFork } from './fake-front.test-helper';
import { FRONT_MIN_UPTIME, FRONT_STOP_MARGIN } from '../constants';

const release = { configuration: 'a', version: '1.0.0' };
const ready = { nodeWebserver: 'ready' as const, release };

describe('createFrontSupervisor', () => {
  const logger = createMockLogger();
  const onLost = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => jest.useRealTimers());

  const create = (count = 2) => {
    const { fork, fronts } = createFakeFork();
    return { fronts, supervisor: createFrontSupervisor({ count, release, fork, logger, onLost }) };
  };

  const started = async (count = 2) => {
    const created = create(count);
    const start = created.supervisor.start();
    created.fronts.forEach((front) => front.say(ready));
    await start;
    return created;
  };

  it('tells every front its place, and resolves once all of them serve', async () => {
    const { supervisor, fronts } = create();
    const resolved = jest.fn();
    const start = supervisor.start().then(resolved);

    fronts[0].say(ready);
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    fronts[1].say(ready);
    await start;

    expect(fronts.map(({ front }) => front)).toEqual([
      { index: 0, count: 2 },
      { index: 1, count: 2 },
    ]);
  });

  it('stops all the fronts and rejects with the reason when one does not start', async () => {
    const { supervisor, fronts } = create();
    const start = expect(supervisor.start()).rejects.toThrow('Front 2 did not start: the port is in use');

    fronts[1].say({ nodeWebserver: 'failed', reason: 'the port is in use' });
    fronts[1].exit(1);
    expect(fronts[0].sent).toEqual([{ nodeWebserver: 'stop' }]);
    fronts[0].exit(0);

    await start;
    jest.runAllTimers();
    expect(fronts).toHaveLength(2);
  });

  it('names how a front that said nothing ended', async () => {
    const { supervisor, fronts } = create(1);
    const start = expect(supervisor.start()).rejects.toThrow('its process ended with SIGKILL');

    fronts[0].exit(null, 'SIGKILL');

    await start;
  });

  it('replaces a front that ends, at once the first time, with the same place and what it has to find', async () => {
    const { fronts } = await started();

    fronts[1].exit(1);
    jest.advanceTimersByTime(0);

    expect(fronts[2].front).toEqual({ index: 1, count: 2, expected: release });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Front 2 ended with code 1'));
  });

  it('waits longer for every front in a row that ends too soon, and not after one that stayed', async () => {
    const { fronts } = await started(1);

    fronts[0].exit(1);
    jest.advanceTimersByTime(0);
    fronts[1].exit(1);
    jest.advanceTimersByTime(99);
    expect(fronts).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(fronts).toHaveLength(3);

    jest.advanceTimersByTime(FRONT_MIN_UPTIME);
    fronts[2].exit(1);
    jest.advanceTimersByTime(0);
    expect(fronts).toHaveLength(4);
  });

  it('compares no replacement when the fronts did not load the configuration of the primary', async () => {
    const { supervisor, fronts } = create();
    const start = supervisor.start();
    fronts[0].say(ready);
    fronts[1].say({ nodeWebserver: 'ready', release: { ...release, configuration: 'b' } });
    await start;

    fronts[0].exit(1);
    jest.advanceTimersByTime(0);

    expect(fronts[2].front).toEqual({ index: 0, count: 2 });
    expect(logger.warning).toHaveBeenCalled();
  });

  it('does not replace a replacement that found something else, and tells when no front is left', async () => {
    const { fronts } = await started();

    fronts.slice(0, 2).forEach((front) => front.exit(1));
    jest.advanceTimersByTime(0);
    fronts[2].say({ nodeWebserver: 'stale', reason: 'another version' });
    fronts[2].exit(0);
    expect(onLost).not.toHaveBeenCalled();
    fronts[3].say({ nodeWebserver: 'stale', reason: 'another version' });
    fronts[3].exit(0);
    jest.runAllTimers();

    expect(fronts).toHaveLength(4);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('another version. Restart the server'));
  });

  it('ignores the messages of others', async () => {
    const { supervisor, fronts } = create(1);
    const resolved = jest.fn();
    supervisor.start().then(resolved);

    fronts[0].say('ready');
    await Promise.resolve();

    expect(resolved).not.toHaveBeenCalled();
  });

  it('passes a message on to every front that runs', async () => {
    const { supervisor, fronts } = await started();

    supervisor.send({ nodeWebserver: 'reload' });

    expect(fronts.map(({ sent }) => sent)).toEqual([[{ nodeWebserver: 'reload' }], [{ nodeWebserver: 'reload' }]]);
  });

  it('stops the fronts, resolves once they ended and starts none in their place', async () => {
    const { supervisor, fronts } = await started();
    const resolved = jest.fn();

    const stop = supervisor.stop({ nodeWebserver: 'stop' }, 1000).then(resolved);
    fronts[0].exit(0);
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    fronts[1].exit(0);
    await stop;
    jest.runAllTimers();

    expect(fronts).toHaveLength(2);
    expect(fronts.map(({ killed }) => killed)).toEqual([false, false]);
  });

  it('kills the fronts that are still there after the timeout', async () => {
    const { supervisor, fronts } = await started();

    const stop = supervisor.stop({ nodeWebserver: 'signal', signal: 'SIGTERM' }, 1000);
    jest.advanceTimersByTime(999);
    expect(fronts.map(({ killed }) => killed)).toEqual([false, false]);
    jest.advanceTimersByTime(1);
    await stop;

    expect(fronts.map(({ killed }) => killed)).toEqual([true, true]);
  });

  it('takes the shorter time of a second stop, which is passed on too', async () => {
    const { supervisor, fronts } = await started(1);
    const message = { nodeWebserver: 'signal' as const, signal: 'SIGTERM' as const };

    const first = supervisor.stop(message, 60000);
    const second = supervisor.stop(message, FRONT_STOP_MARGIN);
    jest.advanceTimersByTime(FRONT_STOP_MARGIN);
    await Promise.all([first, second]);

    expect(fronts[0].sent).toEqual([message, message]);
    expect(fronts[0].killed).toBe(true);
  });

  it('tells a front that starts to listen while it stops, and drops a replacement that waits', async () => {
    const { supervisor, fronts } = create(1);
    supervisor.start();

    supervisor.stop({ nodeWebserver: 'stop' }, 1000);
    fronts[0].say({ nodeWebserver: 'hello' });

    expect(fronts[0].sent).toEqual([{ nodeWebserver: 'stop' }, { nodeWebserver: 'stop' }]);
  });

  it('resolves a stop at once when no front runs', async () => {
    const { supervisor, fronts } = await started(1);
    fronts[0].exit(1);

    await supervisor.stop({ nodeWebserver: 'stop' }, 1000);
    jest.runAllTimers();

    expect(fronts).toHaveLength(1);
  });
});
