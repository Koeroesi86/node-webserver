const chalk = require('chalk');
const moment = require('moment');
const { resolve } = require('path');
const { appendFileSync, mkdirSync, existsSync } = require('fs');
const { ENABLE_FILE_LOGS, LOG_LEVELS, FILE_LOG_PATH } = require(process.env.NODE_WEBSERVER_CONFIG || '../configuration.example');

const startedAt = moment();

if (ENABLE_FILE_LOGS && !FILE_LOG_PATH) {
  throw new Error("Please define FILE_LOG_PATH in configuration or set ENABLE_FILE_LOGS to false.");
}

if (ENABLE_FILE_LOGS && !existsSync(FILE_LOG_PATH)) {
  mkdirSync(FILE_LOG_PATH, { recursive: true });
}

function fileLog(filePath, args = []) {
  if (ENABLE_FILE_LOGS) {
    appendFileSync(filePath, `${args.join(', ')}\n`, 'utf8');
  }
}

module.exports = {
  system: (...args) => {
    if (LOG_LEVELS && LOG_LEVELS.system === false) return;
    fileLog(resolve(FILE_LOG_PATH, `./${startedAt.valueOf()}.system.log`), args);
    return console.log(chalk.blue(...args));
  },
  info: (...args) => {
    if (LOG_LEVELS && LOG_LEVELS.info === false) return;
    fileLog(resolve(FILE_LOG_PATH, `./${startedAt.valueOf()}.info.log`), args);
    return console.log(chalk.magenta(...args));
  },
  success: (...args) => {
    if (LOG_LEVELS && LOG_LEVELS.success === false) return;
    fileLog(resolve(FILE_LOG_PATH, `./${startedAt.valueOf()}.success.log`), args);
    return console.log(chalk.green(...args));
  },
  error: (...args) => {
    if (LOG_LEVELS && LOG_LEVELS.error === false) return;
    fileLog(resolve(FILE_LOG_PATH, `./${startedAt.valueOf()}.error.log`), args);
    return console.log(chalk.red(...args));
  },
  warning: (...args) => {
    if (LOG_LEVELS && LOG_LEVELS.warning === false) return;
    fileLog(resolve(FILE_LOG_PATH, `./${startedAt.valueOf()}.warning.log`), args);
    return console.log(chalk.yellow(...args));
  },
};
