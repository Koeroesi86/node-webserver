import rimraf from 'rimraf';
import { resolve } from 'path';
import { readdirSync, existsSync } from 'fs';
import logger from './logger';
import { PACKAGE_ROOT } from '../constants';
import type { ServerInstance } from '../types';

type ExitReason = NodeJS.Signals | 'exit' | 'uncaughtException';

function cleanTmp() {
  const tmpLocation = resolve(PACKAGE_ROOT, 'tmp');
  if (existsSync(tmpLocation) && readdirSync(tmpLocation).length > 0) {
    rimraf.sync(`${tmpLocation}/*`, { glob: { silent: true } });
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

function exitListener(instances: ServerInstance[], reason: ExitReason, event: unknown) {
  logger.error(`${reason} triggered:\n`, event);

  exitHandler(instances);

  cleanTmp();

  process.kill(process.pid, reason === 'uncaughtException' ? 'SIGINT' : reason);
}

function addExitListeners(instances: ServerInstance[]) {
  process.stdin.resume();

  cleanTmp();

  // do something when app is closing
  process.once('exit', (e) => exitListener(instances, 'exit', e));

  // catches ctrl+c event
  process.once('SIGINT', (e) => exitListener(instances, 'SIGINT', e));

  process.once('SIGHUP', (e) => exitListener(instances, 'SIGHUP', e));
  process.once('SIGTERM', (e) => exitListener(instances, 'SIGTERM', e));

  // catches "kill pid" (for example: nodemon restart)
  process.once('SIGUSR1', (e) => exitListener(instances, 'SIGUSR1', e));
  process.once('SIGUSR2', (e) => exitListener(instances, 'SIGUSR2', e));

  //catches uncaught exceptions
  process.once('uncaughtException', (e) => exitListener(instances, 'uncaughtException', e));
}

export default addExitListeners;
