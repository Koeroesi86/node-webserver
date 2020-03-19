const chalk = require('chalk');
const moment = require('moment');
const { resolve } = require('path');
const { appendFileSync } = require('fs');

const startedAt = moment();

function fileLog(filePath, args = []) {
  if (process.env.NODEWS_ENABLE_FILE_LOGS) {
    appendFileSync(filePath, `${args.join(', ')}\n`, 'utf8');
  }
}

module.exports = {
  system: (...args) => {
    fileLog(resolve(__dirname, `../logs/${startedAt.valueOf()}.system.log`), args);
    return console.log(chalk.blue(...args));
  },
  info: (...args) => {
    fileLog(resolve(__dirname, `../logs/${startedAt.valueOf()}.info.log`), args);
    return console.log(chalk.magenta(...args));
  },
  success: (...args) => {
    fileLog(resolve(__dirname, `../logs/${startedAt.valueOf()}.success.log`), args);
    return console.log(chalk.green(...args));
  },
  error: (...args) => {
    fileLog(resolve(__dirname, `../logs/${startedAt.valueOf()}.error.log`), args);
    return console.log(chalk.red(...args));
  },
  warning: (...args) => {
    fileLog(resolve(__dirname, `../logs/${startedAt.valueOf()}.warning.log`), args);
    return console.log(chalk.yellow(...args));
  },
};
