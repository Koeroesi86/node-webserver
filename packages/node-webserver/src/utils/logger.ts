import moment from 'moment';
import { resolve } from 'path';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import type { Configuration, LogLevels } from '../types';

const { logLevels, fileLogPath }: Pick<Configuration, 'logLevels' | 'fileLogPath'> = require(process.env.NODE_WEBSERVER_CONFIG || '../configuration.example');

const startedAt = moment();

if (fileLogPath === undefined) {
  throw new Error('Please define fileLogPath in configuration.');
}

if (fileLogPath && !existsSync(fileLogPath)) {
  mkdirSync(fileLogPath, { recursive: true });
}

function fileLog(level: keyof LogLevels, args: unknown[]) {
  if (fileLogPath) {
    appendFileSync(resolve(fileLogPath, `./${startedAt.valueOf()}.${level}.log`), `${args.join(', ')}\n`, 'utf8');
  }
}

const createLog =
  (level: keyof LogLevels) =>
  (...args: unknown[]) => {
    if (logLevels && logLevels[level] === false) return;
    fileLog(level, args);
    return console.log(...args);
  };

const logger = {
  system: createLog('system'),
  info: createLog('info'),
  success: createLog('success'),
  error: createLog('error'),
  warning: createLog('warning'),
};

export default logger;
