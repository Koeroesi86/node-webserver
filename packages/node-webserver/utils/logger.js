const moment = require('moment');
const { resolve } = require('path');
const { appendFileSync, mkdirSync, existsSync } = require('fs');
const { logLevels, fileLogPath } = require(process.env.NODE_WEBSERVER_CONFIG || '../configuration.example');

const startedAt = moment();

if (fileLogPath === undefined) {
  throw new Error("Please define fileLogPath in configuration.");
}

if (fileLogPath && !existsSync(fileLogPath)) {
  mkdirSync(fileLogPath, { recursive: true });
}

function fileLog(filePath, args = []) {
  if (fileLogPath) {
    appendFileSync(filePath, `${args.join(', ')}\n`, 'utf8');
  }
}

module.exports = {
  system: (...args) => {
    if (logLevels && logLevels.system === false) return;
    fileLog(resolve(fileLogPath, `./${startedAt.valueOf()}.system.log`), args);
    return console.log(...args);
  },
  info: (...args) => {
    if (logLevels && logLevels.info === false) return;
    fileLog(resolve(fileLogPath, `./${startedAt.valueOf()}.info.log`), args);
    return console.log(...args);
  },
  success: (...args) => {
    if (logLevels && logLevels.success === false) return;
    fileLog(resolve(fileLogPath, `./${startedAt.valueOf()}.success.log`), args);
    return console.log(...args);
  },
  error: (...args) => {
    if (logLevels && logLevels.error === false) return;
    fileLog(resolve(fileLogPath, `./${startedAt.valueOf()}.error.log`), args);
    return console.log(...args);
  },
  warning: (...args) => {
    if (logLevels && logLevels.warning === false) return;
    fileLog(resolve(fileLogPath, `./${startedAt.valueOf()}.warning.log`), args);
    return console.log(...args);
  },
};
