import path from 'path';

const logFolder = path.resolve('/logs');

interface Setup {
  logger: typeof import('./logger').default;
  appendFileSync: jest.Mock;
  onExit: () => void;
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

  /** the logger reads its configuration and the file system when it is imported */
  const load = (configuration: object = {}): Setup => {
    const appendFileSync = jest.fn();
    jest.doMock('fs', () => ({ appendFileSync, mkdirSync: jest.fn(), existsSync: jest.fn(() => true) }));
    jest.doMock('../configuration.example', () => ({ fileLogPath: logFolder, logLevels: { info: true, error: true, success: false }, ...configuration }));
    const exitListeners: Array<() => void> = [];
    jest.spyOn(process, 'on').mockImplementation((event, listener) => {
      if (event === 'exit') exitListeners.push(() => listener(0));
      return process;
    });

    const { default: logger } = require('./logger');

    return { logger, appendFileSync, onExit: () => exitListeners.forEach((listener) => listener()) };
  };

  it('collects the lines of a file and writes them together after the flush interval', () => {
    const { logger, appendFileSync } = load();

    logger.info('one');
    logger.info('two', 'parts');
    expect(appendFileSync).not.toHaveBeenCalled();

    jest.advanceTimersByTime(99);
    expect(appendFileSync).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(appendFileSync).toHaveBeenCalledTimes(1);
    expect(appendFileSync).toHaveBeenCalledWith(expect.stringMatching(/\.info\.log$/), 'one\ntwo, parts\n', 'utf8');
  });

  it('writes a file per level', () => {
    const { logger, appendFileSync } = load();

    logger.info('a');
    logger.error('b');
    jest.advanceTimersByTime(100);

    expect(appendFileSync.mock.calls.map(([file]) => path.basename(file).split('.')[1]).sort()).toEqual(['error', 'info']);
    expect(appendFileSync.mock.calls.every(([file]) => path.dirname(file) === logFolder)).toBe(true);
  });

  it('still logs to the console right away', () => {
    const { logger } = load();

    logger.info('now');

    expect(consoleLog).toHaveBeenCalledWith('now');
  });

  it('writes what is waiting when flushed, and only once', () => {
    const { logger, appendFileSync } = load();
    logger.info('one');

    logger.flush();
    logger.flush();
    jest.advanceTimersByTime(1000);

    expect(appendFileSync).toHaveBeenCalledTimes(1);
  });

  it('writes what is waiting when the process exits', () => {
    const { logger, appendFileSync, onExit } = load();
    logger.info('last words');

    onExit();

    expect(appendFileSync).toHaveBeenCalledWith(expect.any(String), 'last words\n', 'utf8');
  });

  it('writes right away once enough is waiting', () => {
    const { logger, appendFileSync } = load();

    logger.info('x'.repeat(70 * 1024));

    expect(appendFileSync).toHaveBeenCalledTimes(1);
  });

  it('writes every line right away when the flush interval is 0', () => {
    const { logger, appendFileSync } = load({ fileLogFlushInterval: 0 });

    logger.info('one');
    logger.info('two');

    expect(appendFileSync).toHaveBeenCalledTimes(2);
  });

  it('does not write files when file logging is off', () => {
    const { logger, appendFileSync } = load({ fileLogPath: false });

    logger.info('one');
    logger.flush();

    expect(appendFileSync).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledWith('one');
  });

  it('skips the levels that are switched off', () => {
    const { logger, appendFileSync } = load();

    logger.success('quiet');
    logger.flush();

    expect(appendFileSync).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it('survives a file that cannot be written and does not keep its lines', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { logger, appendFileSync } = load();
    appendFileSync.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    logger.info('lost');

    expect(() => logger.flush()).not.toThrow();
    logger.info('kept');
    logger.flush();

    expect(consoleError).toHaveBeenCalled();
    expect(appendFileSync).toHaveBeenLastCalledWith(expect.any(String), 'kept\n', 'utf8');
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

      expect(consoleLog).toHaveBeenCalledTimes(1);
      expect(logger.isEnabled('success')).toBe(false);
      expect(logger.isEnabled('info')).toBe(true);
    });
  });
});
