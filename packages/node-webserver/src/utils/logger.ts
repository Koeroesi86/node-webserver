import moment from 'moment';
import { resolve } from 'path';
import { constants, existsSync, fstatSync, mkdirSync, openSync, write, writeSync } from 'fs';
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

/** the lines waiting to be written, per level, which is per file */
const buffers = new Map<keyof LogLevels, string[]>();
let bufferSize = 0;
/** lines are dropped, and counted, once this many characters wait because the disk does not keep up, so the memory cannot grow without a limit */
const maxQueueSize = 16 * 1024 * 1024;
let dropped = 0;
let flushTimer: NodeJS.Timeout | undefined;

interface LogFile {
  fd: number;
  /** where the next chunk goes. The files are written at a position, so a chunk that has to be written again lands where it was, not behind itself */
  offset: number;
  /** the chunk on its way to the disk */
  pending?: { data: Buffer; position: number };
}

const logFiles = new Map<keyof LogLevels, LogFile>();

function getLogFile(level: keyof LogLevels) {
  const cached = logFiles.get(level);
  if (cached || !fileLogPath) return cached;

  const path = resolve(fileLogPath, `./${startedAt.valueOf()}.${level}.log`);
  // opened once, for reading and writing and created when it is missing: only a file that is not in append mode honours the position of a write
  const fd = openSync(path, constants.O_RDWR | constants.O_CREAT);
  const file: LogFile = { fd, offset: fstatSync(fd).size };
  logFiles.set(level, file);
  return file;
}

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

function writeAll(fd: number, data: Buffer, position: number) {
  let done = 0;
  while (done < data.length) {
    done += writeSync(fd, data, done, data.length - done, position + done);
  }
}

const takeLines = (level: keyof LogLevels) => {
  const lines = buffers.get(level);
  if (!lines) return undefined;

  buffers.delete(level);
  const text = lines.join('');
  bufferSize -= text.length;
  return text;
};

function reportDropped() {
  if (dropped === 0) return;

  console.error(`Dropped ${dropped} log lines, the disk does not keep up.`);
  dropped = 0;
}

function scheduleFlush() {
  // the timer must not keep the process alive
  if (!flushTimer) flushTimer = setTimeout(flushAsync, fileLogFlushInterval).unref();
}

function writeBehind(level: keyof LogLevels, file: LogFile, entry: NonNullable<LogFile['pending']>, done = 0) {
  write(file.fd, entry.data, done, entry.data.length - done, entry.position + done, (error, written) => {
    // a flush that could not wait has written the chunk itself
    if (file.pending !== entry) return;

    if (!error && done + written < entry.data.length) {
      writeBehind(level, file, entry, done + written);
      return;
    }

    file.pending = undefined;
    // a log that cannot be written must not take the server down, nor is it kept until the memory is full. The next chunk goes where this one was meant to
    if (error) {
      file.offset = entry.position;
      console.error(`Could not write log file of ${level}:`, error);
    }
    reportDropped();
    if (buffers.has(level)) scheduleFlush();
  });
}

/** Starts the write of what is buffered without waiting for it, one at a time for each file: what comes meanwhile waits for the next one. */
function flushAsync() {
  clearTimeout(flushTimer);
  flushTimer = undefined;

  Array.from(buffers.keys()).forEach((level) => {
    try {
      const file = getLogFile(level);
      if (!file || file.pending) return;

      const text = takeLines(level);
      if (!text) return;

      const data = Buffer.from(text, 'utf8');
      const entry = { data, position: file.offset };
      file.pending = entry;
      file.offset += data.length;
      writeBehind(level, file, entry);
    } catch (error) {
      takeLines(level);
      console.error(`Could not write log file of ${level}:`, error);
    }
  });

  if (bufferSize > 0) scheduleFlush();
}

/** Writes a file's buffered lines and, before them, the chunk that may not have reached the disk, in the place it belongs. Blocks, for the exit. */
function flushFile(level: keyof LogLevels) {
  try {
    const file = getLogFile(level);
    const text = takeLines(level);
    if (!file) return;

    if (file.pending) {
      const { data, position } = file.pending;
      file.pending = undefined;
      writeAll(file.fd, data, position);
    }

    if (!text) return;
    const data = Buffer.from(text, 'utf8');
    writeAll(file.fd, data, file.offset);
    file.offset += data.length;
  } catch (error) {
    takeLines(level);
    console.error(`Could not write log file of ${level}:`, error);
  }
}

/** Writes everything that waits and returns when it is done, one write per file and one for the console. Safe to call at any time, also when nothing is waiting. */
function flush() {
  flushConsole();
  clearTimeout(flushTimer);
  flushTimer = undefined;

  new Set([...logFiles.keys(), ...buffers.keys()]).forEach(flushFile);
  reportDropped();
}

function fileLog(level: keyof LogLevels, args: unknown[]) {
  if (!fileLogPath) return;

  const line = `${args.join(', ')}\n`;

  if (bufferSize > maxQueueSize) {
    dropped++;
    return;
  }

  const lines = buffers.get(level) ?? [];
  lines.push(line);
  buffers.set(level, lines);
  bufferSize += line.length;

  if (!fileLogFlushInterval) {
    flushFile(level);
  } else if (bufferSize > maxBufferSize) {
    flushAsync();
  } else {
    scheduleFlush();
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
