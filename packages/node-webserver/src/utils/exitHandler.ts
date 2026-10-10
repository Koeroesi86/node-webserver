import { resolve } from 'path';
import { readdirSync, existsSync, rmSync } from 'fs';
import logger from './logger';
import { PACKAGE_ROOT } from '../constants';
import type { ServerInstance } from '../types';

type ExitReason = NodeJS.Signals | 'exit' | 'uncaughtException';

function cleanTmp() {
  const tmpLocation = resolve(PACKAGE_ROOT, 'tmp');
  if (existsSync(tmpLocation) && readdirSync(tmpLocation).length > 0) {
    readdirSync(tmpLocation)
      .filter((name) => !name.startsWith('.'))
      .forEach((name) => rmSync(resolve(tmpLocation, name), { recursive: true, force: true }));
    logger.info('Tmp folder cleaned.');
  }
}

function exitHandler(instances: ServerInstance[]) {
  instances.forEach((instance) => {
    const { child } = instance;

    if (child) {
      child.kill('SIGTERM');
    }
  });
}

function exitListener(getInstances: () => ServerInstance[], reason: ExitReason, event: unknown) {
  logger.error(`${reason} triggered:\n`, event);
  // the signal is raised again below, and a process ended by a signal does not run its exit handlers
  logger.flush();

  exitHandler(getInstances());

  cleanTmp();

  // the process is already exiting, there is nothing left to signal ('exit' is not a signal)
  if (reason === 'exit') return;

  process.kill(process.pid, reason === 'uncaughtException' ? 'SIGINT' : reason);
}

/**
 * Stops the child processes of the servers when the process stops. The servers are asked for when that happens, as they change when the configuration is loaded again.
 * `exitOnHangUp` false leaves SIGHUP to the server, which loads the configuration again on it.
 */
function addExitListeners(getInstances: () => ServerInstance[], { exitOnHangUp = true } = {}) {
  process.stdin.resume();

  cleanTmp();

  // do something when app is closing
  process.once('exit', (e) => exitListener(getInstances, 'exit', e));

  // catches ctrl+c event
  process.once('SIGINT', (e) => exitListener(getInstances, 'SIGINT', e));

  if (exitOnHangUp) {
    process.once('SIGHUP', (e) => exitListener(getInstances, 'SIGHUP', e));
  }
  process.once('SIGTERM', (e) => exitListener(getInstances, 'SIGTERM', e));

  // catches "kill pid" (for example: nodemon restart)
  process.once('SIGUSR1', (e) => exitListener(getInstances, 'SIGUSR1', e));
  process.once('SIGUSR2', (e) => exitListener(getInstances, 'SIGUSR2', e));

  //catches uncaught exceptions
  process.once('uncaughtException', (e) => exitListener(getInstances, 'uncaughtException', e));
}

export default addExitListeners;
