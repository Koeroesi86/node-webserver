import { RESTART_EXIT_CODE } from '../constants';
import type { LauncherMode, PrimaryMessage } from '../types';
import getRestartDelay from './get-restart-delay';
import isServerMessage from './is-server-message';

/** the server as the launcher sees it */
interface ServerHandle {
  pid?: number;
  send: (message: PrimaryMessage) => void;
  onMessage: (listener: (message: unknown) => void) => void;
  onExit: (listener: (code: number | null, signal: string | null) => void) => void;
}

interface LauncherOptions {
  fork: (mode: LauncherMode) => ServerHandle;
  log: (line: string) => void;
  target?: Pick<NodeJS.Process, 'on' | 'off' | 'kill' | 'pid' | 'exit'>;
}

/** the signals that stop or reload a server, which the launcher passes on */
const SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** the ones that always stop it, SIGHUP may reload it */
const STOP_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

const isSignal = (signal: string | null): signal is NodeJS.Signals => signal !== null && signal.startsWith('SIG');

/**
 * A small process that starts the server, and starts it again when it ends with the exit code for a restart. Any other end of the server is its own, as it was. It passes the signals on
 * over the channel to the server, as a signal would end a process at once on some systems. A server that does not start after a restart is tried again, with a delay,
 * as there is none to fall back to.
 */
const createLauncher = ({ fork, log, target = process }: LauncherOptions) => {
  let server: ServerHandle | undefined;
  /** the signals that wait for the server to listen for them */
  let queued: NodeJS.Signals[] = [];
  let listening = false;
  let serving = false;
  /** set once it was told to stop, which no restart follows */
  let stopRequested: NodeJS.Signals | undefined;
  let failures = 0;
  let timer: NodeJS.Timeout | undefined;

  const detach = () => SIGNALS.forEach((signal) => target.off(signal, receiveSignal));

  /** ends the launcher the way the server ended */
  const end = (code: number | null, signal: string | null) => {
    detach();
    if (isSignal(signal)) return target.kill(target.pid, signal);

    return target.exit(code ?? 1);
  };

  const receiveSignal = (signal: NodeJS.Signals) => {
    if (STOP_SIGNALS.includes(signal)) stopRequested = signal;
    if (server && listening) return server.send({ nodeWebserver: 'signal', signal });
    if (server) return queued.push(signal);
    // between two starts there is nothing to reload
    if (!stopRequested) return undefined;

    clearTimeout(timer);
    return end(0, stopRequested);
  };

  const receive = (message: unknown) => {
    if (!isServerMessage(message)) return;
    if (message.nodeWebserver === 'serving') {
      serving = true;
      failures = 0;
      return;
    }

    listening = true;
    queued.splice(0).forEach(receiveSignal);
  };

  const exited = (mode: LauncherMode, code: number | null, signal: string | null) => {
    server = undefined;
    // a restart that the server asked for while it was told to stop is a stop
    if (stopRequested) return code === RESTART_EXIT_CODE ? end(0, stopRequested) : end(code, signal);
    if (code === RESTART_EXIT_CODE) return launch('restart');
    if (mode !== 'restart' || serving) return end(code, signal);

    failures += 1;
    const delay = getRestartDelay(failures);
    log(`The server did not start after its restart (${signal ?? `code ${code}`}), trying again in ${delay} ms.`);
    timer = setTimeout(launch, delay, 'restart');
  };

  const launch = (mode: LauncherMode) => {
    listening = false;
    serving = false;
    queued = [];
    const started = fork(mode);
    server = started;
    if (mode === 'restart') log(`Starting the server again (pid ${started.pid}).`);
    started.onMessage(receive);
    started.onExit((code, signal) => exited(mode, code, signal));
  };

  return {
    start: () => {
      SIGNALS.forEach((signal) => target.on(signal, receiveSignal));
      launch('start');
    },
  };
};

export default createLauncher;
