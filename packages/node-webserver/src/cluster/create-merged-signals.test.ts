import { EventEmitter } from 'events';
import createMergedSignals from './create-merged-signals';
import { SIGNAL_PAIR_WINDOW } from '../constants';

describe('createMergedSignals', () => {
  let time: number;

  const create = () => {
    const kill = jest.fn(() => true);
    const target = Object.assign(new EventEmitter(), { kill, pid: 7 });
    const signals = createMergedSignals(target as unknown as NodeJS.Process, () => time);
    return { signals, kill, target };
  };

  beforeEach(() => (time = 0));

  it('takes the same signal from the process and from the channel as one, whichever comes first', () => {
    const { signals, target } = create();
    const listener = jest.fn();
    signals.on('SIGTERM', listener);

    target.emit('SIGTERM');
    signals.receive('SIGTERM');
    signals.receive('SIGTERM');
    target.emit('SIGTERM');

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('takes a second signal from the same side as another one', () => {
    const { signals } = create();
    const listener = jest.fn();
    signals.on('SIGINT', listener);

    signals.receive('SIGINT');
    signals.receive('SIGINT');

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not pair signals that are far apart', () => {
    const { signals, target } = create();
    const listener = jest.fn();
    signals.on('SIGHUP', listener);

    target.emit('SIGHUP');
    time = SIGNAL_PAIR_WINDOW + 1;
    signals.receive('SIGHUP');

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not pair different signals', () => {
    const { signals, target } = create();
    const listener = jest.fn();
    signals.on('SIGINT', listener);
    signals.on('SIGTERM', listener);

    target.emit('SIGINT');
    signals.receive('SIGTERM');

    expect(listener.mock.calls).toEqual([['SIGINT'], ['SIGTERM']]);
  });

  it('ends the process with a signal that nothing listens for', () => {
    const { signals, kill, target } = create();

    signals.receive('SIGTERM');

    expect(kill).toHaveBeenCalledWith(7, 'SIGTERM');
    expect(target.listenerCount('SIGTERM')).toBe(0);
  });

  it('calls a listener that was added once only once, and none that was taken off', () => {
    const { signals } = create();
    const once = jest.fn();
    const removed = jest.fn();
    signals.once('SIGINT', once);
    signals.on('SIGINT', removed);
    signals.off('SIGINT', removed);
    signals.on('SIGINT', () => {});

    signals.receive('SIGINT');
    signals.receive('SIGINT');

    expect(once).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it('takes its listeners off the process when it is detached', () => {
    const { signals, target } = create();

    signals.detach();

    expect(['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => target.listenerCount(signal))).toEqual([0, 0, 0]);
  });
});
