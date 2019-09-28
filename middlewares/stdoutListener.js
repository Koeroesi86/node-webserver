const moment = require('moment');

const getDate = exports = () =>  moment().format('YYYY-MM-DD HH:mm:ss.SS');

/**
 *
 * @param {Worker} childProcess
 * @param {function} [logger]
 */
module.exports = (childProcess, logger = () => {}) => {
  const messageListener = data => {
    logger(data.toString().trim());
  };
  if (childProcess.stdout) {
    childProcess.stdout.off('data', messageListener);
    childProcess.stdout.on('data', messageListener);
  }
  if (childProcess.stderr) {
    childProcess.stderr.off('data', messageListener);
    childProcess.stderr.on('data', messageListener);
  }

  const closeListener = code => {
    if (code) logger(`[${getDate()}] child process exited with code ${code}`);
  };
  childProcess.addEventListenerOnce('close', closeListener);
};
