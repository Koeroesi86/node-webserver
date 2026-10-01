const moment = require('moment');

const getDate = exports = () =>  moment().format('YYYY-MM-DD HH:mm:ss.SS');
let currentLogger = () => {};
const messageListener = data => {
  currentLogger(data.toString().trim());
};

/**
 *
 * @param {Worker} childProcess
 * @param {function} [logger]
 */
module.exports = (childProcess, logger = () => {}) => {
  currentLogger = logger;

  if (childProcess.stdout && !childProcess.stdout.listeners('data').includes(messageListener)) {
    childProcess.stdout.on('data', messageListener);
  }
  if (childProcess.stderr && !childProcess.stderr.listeners('data').includes(messageListener)) {
    childProcess.stderr.on('data', messageListener);
  }

  const closeListener = code => {
    if (code) logger(`[${getDate()}] child process exited with code ${code}`);

    if (childProcess && childProcess.instance) {
      if (childProcess.stdout) childProcess.stdout.off('data', messageListener);
      if (childProcess.stderr) childProcess.stderr.off('data', messageListener);
    }
  };
  childProcess.addEventListenerOnce('close', closeListener);
};
