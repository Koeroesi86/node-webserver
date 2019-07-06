const logger = require('./logger');
const rimraf = require('rimraf');
const { resolve } = require('path');
const { readdirSync } = require('fs');

function cleanTmp() {
  const tmpLocation = resolve(__dirname, '../tmp');
  if (readdirSync(tmpLocation).length > 0) {
    rimraf.sync(`${tmpLocation}/*`);
    logger.info('Tmp folder cleaned.');
  }
}

function exitHandler(instances) {
  instances.forEach(instance => {
    const { child } = instance;

    if (child) {
      child.kill('SIGTERM');
    }
  });
}


function exitListener(instances, reason, event) {
  logger.error(`${reason} triggered:\n`, event);

  exitHandler(instances);

  cleanTmp();

  process.kill(process.pid, reason);
}

function addExitListeners(instances) {
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

module.exports = addExitListeners;
