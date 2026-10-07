import moment from 'moment';
import { resolve } from 'path';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { formatWithOptions } from 'util';
import type { Configuration, LogLevels } from '../types';

const { logLevels, fileLogPath, fileLogFlushInterval = 100 }: Pick<Configuration, 'logLevels' | 'fileLogPath' | 'fileLogFlushInterval'> = require(process.env
  .NODE_WEBSERVER_CONFIG || '../configuration.example');

const startedAt = moment();
/** a buffer that grows beyond this many characters is written right away */
const maxBufferSize = 64 * 1024;

if (fileLogPath === undefined) {
  throw new Error('Please define fileLogPath in configuration.');
}

if (fileLogPath && !existsSync(fileLogPath)) {
  mkdirSync(fileLogPath, { recursive: true });
}

/** the lines waiting to be written, per file */
const buffers = new Map<string, string[]>();
let bufferSize = 0;
let flushTimer: NodeJS.Timeout | undefined;

/**
 * The lines for the console, which wait until the turn of the event loop is over and leave in one write. Every write is a system call on the thread that
 * serves the requests, and a request logs two lines. Lines of other code that writes to the console directly can come out before them, by at most that turn.
 */
let consoleLines: string[] = [];
let consoleFlushScheduled = false;

function flushConsole() {
  consoleFlushScheduled = false;
  if (consoleLines.length === 0) return;

  const text = consoleLines.join('\n');
  consoleLines = [];
  console.log(text);
}

function consoleLog(args: unknown[]) {
  // formatted like console.log does it, with colors when the console is a terminal, as the lines are joined into a single string
  consoleLines.push(formatWithOptions({ colors: Boolean(process.stdout.isTTY) }, ...args));

  if (!consoleFlushScheduled) {
    consoleFlushScheduled = true;
    setImmediate(flushConsole);
  }
}

/** Writes what is buffered, one write per file and one for the console. Safe to call at any time, also when nothing is waiting. */
function flush() {
  flushConsole();
  clearTimeout(flushTimer);
  flushTimer = undefined;
  const pending = Array.from(buffers.entries());
  buffers.clear();
  bufferSize = 0;

  pending.forEach(([file, lines]) => {
    try {
      appendFileSync(file, lines.join(''), 'utf8');
    } catch (error) {
      // a log that cannot be written must not take the server down, nor is it kept until the memory is full
      console.error(`Could not write ${file}:`, error);
    }
  });
}

function fileLog(level: keyof LogLevels, args: unknown[]) {
  if (!fileLogPath) return;

  const file = resolve(fileLogPath, `./${startedAt.valueOf()}.${level}.log`);
  const line = `${args.join(', ')}\n`;

  if (!fileLogFlushInterval) {
    appendFileSync(file, line, 'utf8');
    return;
  }

  const lines = buffers.get(file) ?? [];
  lines.push(line);
  buffers.set(file, lines);
  bufferSize += line.length;

  if (bufferSize > maxBufferSize) {
    flush();
  } else if (!flushTimer) {
    // the timer must not keep the process alive
    flushTimer = setTimeout(flush, fileLogFlushInterval).unref();
  }
}

process.on('exit', flush);

/** whether lines of the level are logged, to spare building the lines that would be dropped. The levels do not change while the server runs. */
const isEnabled = (level: keyof LogLevels) => !(logLevels && logLevels[level] === false);

const createLog =
  (level: keyof LogLevels) =>
  (...args: unknown[]) => {
    if (!isEnabled(level)) return;
    fileLog(level, args);
    consoleLog(args);
  };

const logger = {
  system: createLog('system'),
  info: createLog('info'),
  success: createLog('success'),
  error: createLog('error'),
  warning: createLog('warning'),
  flush,
  isEnabled,
};

export default logger;
