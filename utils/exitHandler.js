const logger = require('./logger');

function exitHandler(instances) {
  instances.forEach(instance => {
    const { child } = instance;

    if (child) {
      child.kill('SIGTERM');
    }
  });
  process.exit(0);
}

function exitListener(instances, reason, event) {
  logger.error(`${reason} triggered:\n`, event);
  exitHandler(instances);
}

function addExitListeners(instances) {
  process.stdin.resume();

  // do something when app is closing
  process.on('exit', (e) => exitListener(instances, 'exit', e));

  // catches ctrl+c event
  process.on('SIGINT', (e) => exitListener(instances, 'SIGINT', e));

  process.on('SIGHUP', (e) => exitListener(instances, 'SIGHUP', e));
  process.on('SIGTERM', (e) => exitListener(instances, 'SIGTERM', e));

  // catches "kill pid" (for example: nodemon restart)
  process.on('SIGUSR1', (e) => exitListener(instances, 'SIGUSR1', e));
  process.on('SIGUSR2', (e) => exitListener(instances, 'SIGUSR2', e));

  //catches uncaught exceptions
  process.on('uncaughtException', (e) => exitListener(instances, 'uncaughtException', e));

}

module.exports = addExitListeners;
