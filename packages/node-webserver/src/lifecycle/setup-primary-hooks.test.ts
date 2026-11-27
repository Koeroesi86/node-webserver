import { EventEmitter } from 'events';
import setupPrimaryHooks from './setup-primary-hooks';
import createMockLogger from '../observability/mock-logger.test-helper';
import { FRONT_STOP_MARGIN } from '../constants';

describe('setupPrimaryHooks', () => {
  const logger = createMockLogger();
  let target: EventEmitter;
  let kill: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    target = new EventEmitter();
    jest.spyOn(process, 'on').mockImplementation((event, listener) => {
      target.on(event, listener);
      return process;
    });
    jest.spyOn(process, 'off').mockImplementation((event, listener) => {
      target.off(event, listener);
      return process;
    });
    kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => jest.restoreAllMocks());

  const setup = (reloadOnSighup = false) => {
    let finish = () => {};
    const stopped = new Promise<void>((resolve) => (finish = resolve));
    const reload = jest.fn();
    const stop = jest.fn(() => stopped);
    const settings = { reloadOnSighup, shutdownTimeout: 100, watchServers: true };
    const remove = setupPrimaryHooks(true, { settings: () => settings, logger, reload, stop });

    return { reload, stop, remove, settings, finish: () => finish() };
  };

  it('passes a signal on to the fronts, and ends with it once they did, after the log is written', async () => {
    const { stop, finish } = setup();

    target.emit('SIGTERM', 'SIGTERM');
    expect(stop).toHaveBeenCalledWith({ nodeWebserver: 'signal', signal: 'SIGTERM' }, 100 + FRONT_STOP_MARGIN);
    expect(kill).not.toHaveBeenCalled();
    finish();
    await new Promise(process.nextTick);

    expect(logger.flush).toHaveBeenCalled();
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    expect(target.listenerCount('SIGTERM')).toBe(0);
  });

  it('passes a second signal on, with less time for the fronts, and ends only once', async () => {
    const { stop, finish } = setup();

    target.emit('SIGINT', 'SIGINT');
    target.emit('SIGINT', 'SIGINT');
    finish();
    await new Promise(process.nextTick);

    expect(stop).toHaveBeenLastCalledWith({ nodeWebserver: 'signal', signal: 'SIGINT' }, FRONT_STOP_MARGIN);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('stops on SIGHUP without reloadOnSighup', () => {
    const { stop, reload } = setup();

    target.emit('SIGHUP', 'SIGHUP');

    expect(stop).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads on SIGHUP with reloadOnSighup', () => {
    const { stop, reload } = setup(true);

    target.emit('SIGHUP', 'SIGHUP');

    expect(reload).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  it('takes the settings as they are when the signal comes', () => {
    const { reload, stop, settings } = setup(false);
    settings.reloadOnSighup = true;

    target.emit('SIGHUP', 'SIGHUP');

    expect(reload).toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('listens to the signals of the source it is given, which it detaches before it ends with one', async () => {
    const source = Object.assign(new EventEmitter(), { detach: jest.fn() });
    const settings = { reloadOnSighup: false, shutdownTimeout: 1, watchServers: true };
    setupPrimaryHooks(true, { signals: source, settings: () => settings, logger, reload: jest.fn(), stop: async () => undefined });

    source.emit('SIGTERM', 'SIGTERM');
    await new Promise(process.nextTick);

    expect(source.detach.mock.invocationCallOrder[0]).toBeLessThan(kill.mock.invocationCallOrder[0]);
    expect(source.eventNames()).toEqual([]);
  });

  it('takes every listener off again', () => {
    const { remove } = setup(true);

    remove();

    expect(target.eventNames()).toEqual([]);
  });

  it('adds nothing when it is disabled', () => {
    const remove = setupPrimaryHooks(false, { settings: jest.fn(), logger, reload: jest.fn(), stop: jest.fn() });

    remove();

    expect(target.eventNames()).toEqual([]);
  });
});
