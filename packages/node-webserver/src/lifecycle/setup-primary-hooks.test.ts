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
    const send = jest.fn();
    const stop = jest.fn(() => stopped);
    const remove = setupPrimaryHooks(true, { reloadOnSighup, shutdownTimeout: 100, logger, send, stop });

    return { send, stop, remove, finish: () => finish() };
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
    const { stop, send } = setup();

    target.emit('SIGHUP', 'SIGHUP');

    expect(stop).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('passes SIGHUP on to reload with reloadOnSighup', () => {
    const { stop, send } = setup(true);

    target.emit('SIGHUP', 'SIGHUP');

    expect(send).toHaveBeenCalledWith({ nodeWebserver: 'signal', signal: 'SIGHUP' });
    expect(stop).not.toHaveBeenCalled();
  });

  it('takes every listener off again', () => {
    const { remove } = setup(true);

    remove();

    expect(target.eventNames()).toEqual([]);
  });

  it('adds nothing when it is disabled', () => {
    const remove = setupPrimaryHooks(false, { reloadOnSighup: true, shutdownTimeout: 1, logger, send: jest.fn(), stop: jest.fn() });

    remove();

    expect(target.eventNames()).toEqual([]);
  });
});
