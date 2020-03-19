const chalk = require('chalk');
const moment = require('moment');
const { resolve } = require('path');
const { appendFileSync } = require('fs');
const { ENABLE_FILE_LOGS, LOG_LEVELS } = require('../configuration');

const startedAt = moment();

function fileLog(filePath, args = []) {
  if (ENABLE_FILE_LOGS) {
    appendFileSync(filePath, `${args.join(', ')}\n`, 'utf8');
  }
}

module.exports = {
  system: (...args) => {
    if (LOG_LEVELS && LOG_LEVELS.system === false) return;
    fileLog(resolve(__dirname, `../logs/${startedAt.valueOf()}.system.log`), args);
    return console.log(chalk.blue(...args));
  },
  info: (...args) => {
    if (LOG_LEVELS && LOG_LEVELS.info === false) return;
    fileLog(resolve(__dirname, `../logs/${startedAt.valueOf()}.info.log`), args);
    return console.log(chalk.magenta(...args));
  },
  success: (...args) => {
    if (LOG_LEVELS && LOG_LEVELS.success === false) return;
    fileLog(resolve(__dirname, `../logs/${startedAt.valueOf()}.success.log`), args);
    return console.log(chalk.green(...args));
  },
  error: (...args) => {
    if (LOG_LEVELS && LOG_LEVELS.error === false) return;
    fileLog(resolve(__dirname, `../logs/${startedAt.valueOf()}.error.log`), args);
    return console.log(chalk.red(...args));
  },
  warning: (...args) => {
    if (LOG_LEVELS && LOG_LEVELS.warning === false) return;
    fileLog(resolve(__dirname, `../logs/${startedAt.valueOf()}.warning.log`), args);
    return console.log(chalk.yellow(...args));
  },
};
