import { resolve } from 'path';
import { readdirSync, existsSync, rmSync } from 'fs';
import { PACKAGE_ROOT } from '../constants';
import type { Logger, ServerState } from '../types';

type ExitReason = NodeJS.Signals | 'exit' | 'uncaughtException';

export interface ExitOptions {
  /** `exitOnHangUp` false leaves SIGHUP to the server, which loads the configuration again on it */
  exitOnHangUp?: boolean;
  /** stops the server softly on SIGINT, SIGTERM and SIGHUP before the process ends. A second one of these signals ends it at once. Without it they end it at once. */
  gracefulStop?: () => Promise<void>;
}

function cleanTmp(logger: Logger) {
  const tmpLocation = resolve(PACKAGE_ROOT, 'tmp');
  if (existsSync(tmpLocation) && readdirSync(tmpLocation).length > 0) {
    readdirSync(tmpLocation)
      .filter((name) => !name.startsWith('.'))
      .forEach((name) => rmSync(resolve(tmpLocation, name), { recursive: true, force: true }));
    logger.info('Tmp folder cleaned.');
  }
}

function exitHandler(hosts: ServerState[]) {
  hosts.forEach(({ runtime: { child } }) => {
    if (child) {
      child.kill('SIGTERM');
    }
  });
}

function exitListener(logger: Logger, getInstances: () => ServerState[], reason: ExitReason, event: unknown) {
  logger.error(`${reason} triggered:\n`, event);
  // the signal is raised again below, and a process ended by a signal does not run its exit handlers
  logger.flush();

  exitHandler(getInstances());

  cleanTmp(logger);

  // the process is already exiting, there is nothing left to signal ('exit' is not a signal)
  if (reason === 'exit') return;

  process.kill(process.pid, reason === 'uncaughtException' ? 'SIGINT' : reason);
}

/**
 * Stops the child processes of the servers when the process stops. The servers are asked for when that happens, as they change when the configuration is loaded again.
 * SIGUSR1 (which node also uses to start the inspector), SIGUSR2 and an uncaught exception always end the process at once, as the state may be broken.
 * Returns a function that takes the listeners off again, so that a server that is stopped in a process that goes on (or a test) does not leave them behind.
 */
function addExitListeners(logger: Logger, getInstances: () => ServerState[], { exitOnHangUp = true, gracefulStop }: ExitOptions = {}): () => void {
  process.stdin.resume();

  cleanTmp(logger);

  const stopAtOnce = (reason: ExitReason) => (event: unknown) => exitListener(logger, getInstances, reason, event);
  const signals: NodeJS.Signals[] = exitOnHangUp ? ['SIGINT', 'SIGTERM', 'SIGHUP'] : ['SIGINT', 'SIGTERM'];

  const stopSoftly = (reason: NodeJS.Signals) => async (event: unknown) => {
    logger.system(`${reason} received, finishing the requests in flight. Another one of ${signals.join(', ')} ends the process at once.`);
    const second = signals.map((signal) => ({ signal, listener: stopAtOnce(signal) }));
    second.forEach(({ signal, listener }) => process.once(signal, listener));

    await gracefulStop?.().catch((error) => logger.error('The graceful stop failed:', error));

    // the signal is raised again below, which these would catch
    second.forEach(({ signal, listener }) => process.off(signal, listener));
    exitListener(logger, getInstances, reason, event);
  };

  const listeners: [NodeJS.Signals | 'exit' | 'uncaughtException', (event: unknown) => void][] = [
    // do something when app is closing
    ['exit', stopAtOnce('exit')],
    ...signals.map((signal): [NodeJS.Signals, (event: unknown) => void] => [signal, gracefulStop ? stopSoftly(signal) : stopAtOnce(signal)]),
    // catches "kill pid" (for example: nodemon restart)
    ['SIGUSR1', stopAtOnce('SIGUSR1')],
    ['SIGUSR2', stopAtOnce('SIGUSR2')],
    //catches uncaught exceptions
    ['uncaughtException', stopAtOnce('uncaughtException')],
  ];
  listeners.forEach(([event, listener]) => process.once(event, listener));

  return () => listeners.forEach(([event, listener]) => process.off(event, listener));
}

export default addExitListeners;
