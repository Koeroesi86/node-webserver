const getDate = require('./getDate');
const logger = require('./logger');

module.exports = child => {
  const messageListener = data => {
    logger.info(`[${getDate()}] ${data.toString().trim()}`);
  };
  if (child.stdout) {
    child.stdout.off('data', messageListener);
    child.stdout.on('data', messageListener);
  }

  const errorListener = data => {
    logger.error(`[${getDate()}] ${data.toString().trim()}`);
  };
  if (child.stderr) {
    child.stderr.off('data', errorListener);
    child.stderr.on('data', errorListener);
  }

  const closeListener = code => {
    if (code) {
      logger.error(`[${getDate()}] child process exited with code ${code}`);
    }
  };
  child.off('close', closeListener);
  child.on('close', closeListener);
};
