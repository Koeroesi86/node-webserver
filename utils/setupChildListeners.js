const moment = require('moment');

function getDate() {
  return moment().format('YYYY-MM-DD HH:mm:ss');
}

module.exports = function setupChildListeners(instances) {
  instances.map(instance => {
    const { child } = instance;

    child.stdout.on('data', (data) => {
      console.info(`[${getDate()}] ${data}`);
    });

    child.stderr.on('data', (data) => {
      console.warn(`[${getDate()}] ${data}`);
    });

    child.on('close', (code) => {
      console.error(`[${getDate()}] child process exited with code ${code}`);
    });

    return instance;
  });
};