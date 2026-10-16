import { existsSync, mkdirSync } from 'fs';
import type { Logger, LoggerConfiguration, LogLevels } from '../types';
import createConsoleBatcher from './create-console-batcher';
import createFileSink from './create-file-sink';

/**
 * A logger that writes a file per level, in the folder of `fileLogPath`, and the console. Nothing is touched but that folder, and the lines that wait are written
 * when `flush` is called: the one who creates it decides when that is, for example when the process exits.
 */
const createLogger = ({ logLevels, fileLogPath, fileLogFlushInterval = 100 }: LoggerConfiguration): Logger => {
  if (fileLogPath === undefined) {
    throw new Error('Please define fileLogPath in configuration.');
  }

  if (fileLogPath && !existsSync(fileLogPath)) {
    mkdirSync(fileLogPath, { recursive: true });
  }

  const consoleBatcher = createConsoleBatcher();
  const fileSink = fileLogPath ? createFileSink({ folder: fileLogPath, startedAt: Date.now(), flushInterval: fileLogFlushInterval }) : undefined;

  /** whether lines of the level are logged, to spare building the lines that would be dropped. The levels do not change while the server runs. */
  const isEnabled = (level: keyof LogLevels) => !(logLevels && logLevels[level] === false);

  const createLog =
    (level: keyof LogLevels) =>
    (...args: unknown[]) => {
      if (!isEnabled(level)) return;
      fileSink?.log(level, args);
      consoleBatcher.log(args);
    };

  /** Writes everything that waits and returns when it is done, one write per file and one for the console. Safe to call at any time, also when nothing is waiting. */
  const flush = () => {
    consoleBatcher.flush();
    fileSink?.flush();
  };

  return {
    system: createLog('system'),
    info: createLog('info'),
    success: createLog('success'),
    error: createLog('error'),
    warning: createLog('warning'),
    flush,
    isEnabled,
  };
};

export default createLogger;
