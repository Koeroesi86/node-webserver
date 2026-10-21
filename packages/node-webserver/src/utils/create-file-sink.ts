import { resolve } from 'path';
import { constants, fstatSync, openSync, write } from 'fs';
import { LOG_MAX_BUFFER_SIZE, LOG_MAX_QUEUE_SIZE } from '../constants';
import type { LogFile, LogLevels } from '../types';
import writeAll from './write-all';

interface FileSinkOptions {
  /** the folder of the files, which exists */
  folder: string;
  /** part of the file names, so the files of a run belong together */
  startedAt: number;
  /** 0 writes every line right away */
  flushInterval: number;
}

/**
 * A file per level in the folder. The lines wait in a buffer per level and are written behind, one chunk at a time for each file, so the thread that serves the
 * requests does not wait for the disk. `flush` writes what waits and blocks, for the exit.
 */
const createFileSink = ({ folder, startedAt, flushInterval }: FileSinkOptions) => {
  /** the lines waiting to be written, per level, which is per file */
  const buffers = new Map<keyof LogLevels, string[]>();
  const logFiles = new Map<keyof LogLevels, LogFile>();
  let bufferSize = 0;
  let dropped = 0;
  let flushTimer: NodeJS.Timeout | undefined;

  function getLogFile(level: keyof LogLevels) {
    const cached = logFiles.get(level);
    if (cached) return cached;

    // opened once, for reading and writing and created when it is missing: only a file that is not in append mode honours the position of a write
    const fd = openSync(resolve(folder, `./${startedAt}.${level}.log`), constants.O_RDWR | constants.O_CREAT);
    const file: LogFile = { fd, offset: fstatSync(fd).size };
    logFiles.set(level, file);
    return file;
  }

  function takeLines(level: keyof LogLevels) {
    const lines = buffers.get(level);
    if (!lines) return undefined;

    buffers.delete(level);
    const text = lines.join('');
    bufferSize -= text.length;
    return text;
  }

  function reportDropped() {
    if (dropped === 0) return;

    console.error(`Dropped ${dropped} log lines, the disk does not keep up.`);
    dropped = 0;
  }

  function scheduleFlush() {
    // the timer must not keep the process alive
    if (!flushTimer) flushTimer = setTimeout(flushAsync, flushInterval).unref();
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

  function beginWrite(level: keyof LogLevels) {
    const file = getLogFile(level);
    const text = file.pending ? undefined : takeLines(level);
    if (!text) return;

    const data = Buffer.from(text, 'utf8');
    const entry = { data, position: file.offset };
    file.pending = entry;
    file.offset += data.length;
    writeBehind(level, file, entry);
  }

  function startWrite(level: keyof LogLevels) {
    try {
      beginWrite(level);
    } catch (error) {
      takeLines(level);
      console.error(`Could not write log file of ${level}:`, error);
    }
  }

  /** Starts the write of what is buffered without waiting for it, one at a time for each file: what comes meanwhile waits for the next one. */
  function flushAsync() {
    clearTimeout(flushTimer);
    flushTimer = undefined;

    Array.from(buffers.keys()).forEach(startWrite);

    if (bufferSize > 0) scheduleFlush();
  }

  /** Writes a file's buffered lines and, before them, the chunk that may not have reached the disk, in the place it belongs. Blocks, for the exit. */
  function writeFile(level: keyof LogLevels) {
    const file = getLogFile(level);
    const text = takeLines(level);

    if (file.pending) {
      const { data, position } = file.pending;
      file.pending = undefined;
      writeAll(file.fd, data, position);
    }

    if (!text) return;
    const data = Buffer.from(text, 'utf8');
    writeAll(file.fd, data, file.offset);
    file.offset += data.length;
  }

  function flushFile(level: keyof LogLevels) {
    try {
      writeFile(level);
    } catch (error) {
      takeLines(level);
      console.error(`Could not write log file of ${level}:`, error);
    }
  }

  /** Writes everything that waits and returns when it is done. Safe to call at any time, also when nothing is waiting. */
  function flush() {
    clearTimeout(flushTimer);
    flushTimer = undefined;

    new Set([...logFiles.keys(), ...buffers.keys()]).forEach(flushFile);
    reportDropped();
  }

  function log(level: keyof LogLevels, args: unknown[]) {
    if (bufferSize > LOG_MAX_QUEUE_SIZE) {
      dropped++;
      return;
    }

    const line = `${args.join(', ')}\n`;
    const lines = buffers.get(level) ?? [];
    lines.push(line);
    buffers.set(level, lines);
    bufferSize += line.length;

    if (!flushInterval) return flushFile(level);
    if (bufferSize > LOG_MAX_BUFFER_SIZE) return flushAsync();
    scheduleFlush();
  }

  return { log, flush };
};

export default createFileSink;
