import { EventEmitter } from 'events';
import { SIGNAL_PAIR_WINDOW } from '../constants';
import type { MergedSignals } from '../types';

const SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

type From = 'process' | 'channel';

interface Received {
  signal: NodeJS.Signals;
  from: From;
  at: number;
}

type SignalTarget = Pick<NodeJS.Process, 'on' | 'off' | 'kill' | 'pid'>;

/**
 * The signals of a front or of a primary: the ones sent to its process, and the ones passed on over the channel to it, by the primary or the launcher. systemd and Ctrl+C signal every
 * process, and the signal is passed on as well, so the same signal from both within a moment is one: as a second one it would end the server at once.
 * A signal that nothing listens for ends the process, as it does by default.
 */
const createMergedSignals = (target: SignalTarget = process, now = Date.now): MergedSignals => {
  const merged = new EventEmitter();
  let unpaired: Received[] = [];

  const detach = () => listeners.forEach(({ signal, listener }) => target.off(signal, listener));

  const deliver = (from: From, signal: NodeJS.Signals) => {
    unpaired = unpaired.filter(({ at }) => now() - at <= SIGNAL_PAIR_WINDOW);
    const pair = unpaired.find((received) => received.signal === signal && received.from !== from);

    if (pair) {
      unpaired = unpaired.filter((received) => received !== pair);
      return;
    }

    unpaired.push({ signal, from, at: now() });
    if (merged.emit(signal, signal)) return;

    detach();
    target.kill(target.pid, signal);
  };

  const listeners = SIGNALS.map((signal) => ({ signal, listener: () => deliver('process', signal) }));
  listeners.forEach(({ signal, listener }) => target.on(signal, listener));

  return {
    on: (signal, listener) => merged.on(signal, listener),
    once: (signal, listener) => merged.once(signal, listener),
    off: (signal, listener) => merged.off(signal, listener),
    detach,
    receive: (signal) => deliver('channel', signal),
  };
};

export default createMergedSignals;
