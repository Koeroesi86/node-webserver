import path from 'path';

const logFolder = path.resolve('/logs');

interface Setup {
  logger: typeof import('./logger').default;
  fs: { openSync: jest.Mock; write: jest.Mock; writeSync: jest.Mock };
  onExit: () => void;
  /** what is in the file of the level, as the disk has it */
  content: (level: string) => string | undefined;
  /** lets the writes that were started finish, as the disk would */
  finishWrites: () => void;
}

describe('logger', () => {
  let consoleLog: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.resetModules();
  });

  /** the logger reads its configuration and the file system when it is imported. The disk keeps what is written at the position it is written to */
  const load = (configuration: object = {}): Setup => {
    const disk = new Map<string, Buffer>();
    const paths = new Map<number, string>();
    const started: Array<() => void> = [];
    const put = (fd: number, data: Buffer, offset: number, length: number, position: number) => {
      const file = paths.get(fd) as string;
      const current = disk.get(file) as Buffer;
      const next = Buffer.alloc(Math.max(current.length, position + length));
      current.copy(next);
      data.copy(next, position, offset, offset + length);
      disk.set(file, next);
      return length;
    };
    const fs = {
      openSync: jest.fn((file: string) => {
        const fd = paths.size + 3;
        paths.set(fd, file);
        if (!disk.has(file)) disk.set(file, Buffer.alloc(0));
        return fd;
      }),
      write: jest.fn((fd: number, data: Buffer, offset: number, length: number, position: number, done: (error: Error | null, written: number) => void) => {
        started.push(() => done(null, put(fd, data, offset, length, position)));
      }),
      writeSync: jest.fn(put),
    };
    jest.doMock('fs', () => ({
      ...fs,
      constants: jest.requireActual('fs').constants,
      fstatSync: (fd: number) => ({ size: (disk.get(paths.get(fd) as string) as Buffer).length }),
      mkdirSync: jest.fn(),
      existsSync: jest.fn(() => true),
    }));
    jest.doMock('../configuration.example', () => ({ fileLogPath: logFolder, logLevels: { info: true, error: true, success: false }, ...configuration }));
    const exitListeners: Array<() => void> = [];
    jest.spyOn(process, 'on').mockImplementation((event, listener) => {
      if (event === 'exit') exitListeners.push(() => listener(0));
      return process;
    });

    const { default: logger } = require('./logger');

    return {
      logger,
      fs,
      onExit: () => exitListeners.forEach((listener) => listener()),
      content: (level) =>
        Array.from(disk.entries())
          .find(([file]) => file.endsWith(`.${level}.log`))?.[1]
          .toString(),
      finishWrites: () => started.splice(0).forEach((finish) => finish()),
    };
  };

  it('collects the lines of a file and writes them together after the flush interval', () => {
    const { logger, fs, content, finishWrites } = load();

    logger.info('one');
    logger.info('two', 'parts');
    expect(fs.write).not.toHaveBeenCalled();

    jest.advanceTimersByTime(99);
    expect(fs.write).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(fs.write).toHaveBeenCalledTimes(1);
    finishWrites();
    expect(content('info')).toBe('one\ntwo, parts\n');
  });

  it('writes a file per level', () => {
    const { logger, fs } = load();

    logger.info('a');
    logger.error('b');
    jest.advanceTimersByTime(100);

    const files = fs.openSync.mock.calls.map(([file]) => file);
    expect(files.map((file) => path.basename(file).split('.')[1]).sort()).toEqual(['error', 'info']);
    expect(files.every((file) => path.dirname(file) === logFolder)).toBe(true);
  });

  it('opens the file of a level once, not for every write', () => {
    const { logger, fs, finishWrites } = load();

    logger.info('a');
    jest.advanceTimersByTime(100);
    finishWrites();
    logger.info('b');
    jest.advanceTimersByTime(100);
    finishWrites();

    expect(fs.openSync).toHaveBeenCalledTimes(1);
    expect(fs.write).toHaveBeenCalledTimes(2);
  });

  it('writes one chunk at a time to a file, in order, and the lines that come meanwhile wait for the next', () => {
    const { logger, fs, content, finishWrites } = load();

    logger.info('a');
    jest.advanceTimersByTime(100);
    logger.info('b');
    jest.advanceTimersByTime(100);
    expect(fs.write).toHaveBeenCalledTimes(1);

    finishWrites();
    jest.advanceTimersByTime(100);
    expect(fs.write).toHaveBeenCalledTimes(2);
    finishWrites();

    expect(content('info')).toBe('a\nb\n');
  });

  it('writes the rest of a chunk that the disk took only a part of', () => {
    const { logger, fs, content, finishWrites } = load();
    const write = fs.write.getMockImplementation() as (...args: unknown[]) => void;
    fs.write.mockImplementationOnce((fd, data, offset, length, position, done) => write(fd, data, offset, 2, position, done));

    logger.info('abcdef');
    jest.advanceTimersByTime(100);
    finishWrites();
    finishWrites();

    expect(content('info')).toBe('abcdef\n');
  });

  describe('the console', () => {
    it('gets the lines at the end of the turn of the event loop, not before', () => {
      const { logger } = load();

      logger.info('now');
      expect(consoleLog).not.toHaveBeenCalled();

      jest.runOnlyPendingTimers();
      expect(consoleLog).toHaveBeenCalledWith('now');
    });

    it('gets the lines of a turn in one write, in order', () => {
      const { logger } = load();

      logger.info('first');
      logger.error('second');
      logger.info('third');
      jest.runOnlyPendingTimers();

      expect(consoleLog).toHaveBeenCalledTimes(1);
      expect(consoleLog).toHaveBeenCalledWith('first\nsecond\nthird');
    });

    it('gets the lines of the next turn in another write', () => {
      const { logger } = load();

      logger.info('first');
      jest.runOnlyPendingTimers();
      logger.info('second');
      jest.runOnlyPendingTimers();

      expect(consoleLog.mock.calls).toEqual([['first'], ['second']]);
    });

    it('is written when flushed, and not again afterwards', () => {
      const { logger } = load();

      logger.info('now');
      logger.flush();
      jest.runOnlyPendingTimers();

      expect(consoleLog).toHaveBeenCalledTimes(1);
    });

    it('is written when the process exits', () => {
      const { logger, onExit } = load();

      logger.info('last words');
      onExit();

      expect(consoleLog).toHaveBeenCalledWith('last words');
    });

    it('formats the arguments as console.log does', () => {
      const { logger } = load();

      logger.info('a', 1, { b: 2 }, ['c']);
      jest.runOnlyPendingTimers();

      expect(consoleLog).toHaveBeenCalledWith("a 1 { b: 2 } [ 'c' ]");
    });

    it('leaves what looks like a format specifier in a line as it is', () => {
      const { logger } = load();

      logger.info('cpu 100% %s %d');
      jest.runOnlyPendingTimers();

      expect(consoleLog).toHaveBeenCalledWith('cpu 100% %s %d');
    });

    it('shows the stack of an error', () => {
      const { logger } = load();

      logger.error(new Error('broken'));
      jest.runOnlyPendingTimers();

      expect(consoleLog.mock.calls[0][0]).toContain('Error: broken');
      expect(consoleLog.mock.calls[0][0]).toContain('logger.test');
    });

    it('does not wait for anything for a level that is off', () => {
      const { logger } = load();

      logger.success('quiet');

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it('writes what is waiting when flushed, and only once', () => {
    const { logger, fs, content } = load();
    logger.info('one');

    logger.flush();
    logger.flush();
    jest.advanceTimersByTime(1000);

    expect(fs.writeSync).toHaveBeenCalledTimes(1);
    expect(fs.write).not.toHaveBeenCalled();
    expect(content('info')).toBe('one\n');
  });

  it('writes what is waiting when the process exits', () => {
    const { logger, content, onExit } = load();
    logger.info('last words');

    onExit();

    expect(content('info')).toBe('last words\n');
  });

  it('writes a chunk that is on its way to the disk when the process exits, once and before the lines that came after it', () => {
    const { logger, fs, content, finishWrites, onExit } = load();
    logger.info('first');
    jest.advanceTimersByTime(100);
    logger.info('second');

    onExit();
    expect(content('info')).toBe('first\nsecond\n');

    // the write that was on its way finishes late, and is not written a second time behind the others
    finishWrites();
    expect(content('info')).toBe('first\nsecond\n');
    expect(fs.write).toHaveBeenCalledTimes(1);
  });

  it('starts writing right away once enough is waiting', () => {
    const { logger, fs } = load();

    logger.info('x'.repeat(70 * 1024));

    expect(fs.write).toHaveBeenCalledTimes(1);
  });

  it('writes every line right away when the flush interval is 0', () => {
    const { logger, fs, content } = load({ fileLogFlushInterval: 0 });

    logger.info('one');
    logger.info('two');

    expect(fs.writeSync).toHaveBeenCalledTimes(2);
    expect(content('info')).toBe('one\ntwo\n');
  });

  it('does not write files when file logging is off', () => {
    const { logger, fs } = load({ fileLogPath: false });

    logger.info('one');
    logger.flush();

    expect(fs.openSync).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledWith('one');
  });

  it('skips the levels that are switched off', () => {
    const { logger, fs } = load();

    logger.success('quiet');
    logger.flush();

    expect(fs.openSync).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it('survives a write that fails and does not keep its lines', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { logger, fs, content, finishWrites } = load();
    fs.write.mockImplementationOnce((fd, data, offset, length, position, done) => done(new Error('disk full'), 0));
    logger.info('lost');
    jest.advanceTimersByTime(100);

    logger.info('kept');
    jest.advanceTimersByTime(100);
    finishWrites();

    expect(consoleError).toHaveBeenCalled();
    expect(content('info')).toBe('kept\n');
  });

  it('survives a file that cannot be opened and does not keep its lines', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { logger, fs, content } = load();
    fs.openSync.mockImplementationOnce(() => {
      throw new Error('no permission');
    });
    logger.info('lost');

    expect(() => logger.flush()).not.toThrow();
    logger.info('kept');
    logger.flush();

    expect(consoleError).toHaveBeenCalled();
    expect(content('info')).toBe('kept\n');
  });

  it('survives a write that fails when it has to wait for it', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { logger, fs } = load({ fileLogFlushInterval: 0 });
    fs.writeSync.mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    expect(() => logger.info('lost')).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
  });

  it('drops lines, and says how many, once too much waits for a disk that does not keep up', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { logger, finishWrites } = load();

    // the first write never finishes, so the rest piles up
    logger.info('x'.repeat(70 * 1024));
    Array.from({ length: 20 }, () => logger.info('x'.repeat(1024 * 1024)));
    expect(consoleError).not.toHaveBeenCalled();

    finishWrites();

    expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/^Dropped [1-9]\d* log lines/));
  });

  describe('isEnabled', () => {
    it('says which levels are logged, the ones that are not off', () => {
      const { logger } = load({ logLevels: { info: true, error: true, success: false, warning: false } });

      expect(['info', 'error', 'success', 'warning'].map((level) => logger.isEnabled(level as 'info'))).toEqual([true, true, false, false]);
    });

    it('counts a level that is not mentioned as logged', () => {
      const { logger } = load({ logLevels: { info: false } });

      expect(logger.isEnabled('system')).toBe(true);
    });

    it('logs everything when there are no levels at all', () => {
      const { logger } = load({ logLevels: undefined });

      expect(logger.isEnabled('success')).toBe(true);
    });

    it('agrees with what the logger prints', () => {
      const { logger } = load({ logLevels: { info: true, success: false } });

      logger.success('hidden');
      logger.info('shown');
      logger.flush();

      expect(consoleLog).toHaveBeenCalledTimes(1);
      expect(consoleLog).toHaveBeenCalledWith('shown');
      expect(logger.isEnabled('success')).toBe(false);
      expect(logger.isEnabled('info')).toBe(true);
    });
  });
});
