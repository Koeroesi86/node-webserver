interface FsMock {
  openSync: jest.Mock;
  fstatSync: jest.Mock;
  write: jest.Mock;
  writeSync: jest.Mock;
}

describe('createFileSink', () => {
  let fs: FsMock;
  let consoleError: jest.SpyInstance;
  const finish: Array<(error: Error | null, written: number) => void> = [];

  const load = (flushInterval = 100) => {
    jest.doMock('fs', () => ({ ...fs, constants: jest.requireActual('fs').constants }));
    return require('./create-file-sink').default({ folder: '/logs', startedAt: 5, flushInterval });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    finish.length = 0;
    fs = {
      openSync: jest.fn(() => 3),
      fstatSync: jest.fn(() => ({ size: 10 })),
      write: jest.fn((_fd, data: Buffer, _offset, length: number, _position, done) =>
        finish.push((error, written) => done(error, error ? 0 : (written ?? length)))
      ),
      writeSync: jest.fn((_fd, _data, _offset, length: number) => length),
    };
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('opens nothing until a line is written, then the file of the level once, after the size it has', () => {
    const sink = load();
    expect(fs.openSync).not.toHaveBeenCalled();

    sink.log('info', ['a']);
    sink.log('info', ['b']);
    jest.advanceTimersByTime(100);

    expect(fs.openSync).toHaveBeenCalledTimes(1);
    expect(fs.openSync.mock.calls[0][0]).toMatch(/5\.info\.log$/);
    expect(fs.write).toHaveBeenCalledWith(3, Buffer.from('a\nb\n'), 0, 4, 10, expect.any(Function));
  });

  it('writes a chunk at a time for a file, the next one behind the first', () => {
    const sink = load();

    sink.log('info', ['a']);
    jest.advanceTimersByTime(100);
    sink.log('info', ['b']);
    jest.advanceTimersByTime(100);
    expect(fs.write).toHaveBeenCalledTimes(1);

    finish.splice(0).forEach((done) => done(null, 2));
    jest.advanceTimersByTime(100);

    expect(fs.write).toHaveBeenCalledTimes(2);
    expect(fs.write.mock.calls[1][4]).toBe(12);
  });

  it('writes a chunk again where it was when the write failed', () => {
    const sink = load();

    sink.log('info', ['a']);
    jest.advanceTimersByTime(100);
    finish.splice(0).forEach((done) => done(new Error('disk'), 0));
    sink.log('info', ['b']);
    jest.advanceTimersByTime(100);

    expect(consoleError).toHaveBeenCalledWith('Could not write log file of info:', expect.any(Error));
    expect(fs.write.mock.calls[1][4]).toBe(10);
  });

  it('writes the pending chunk before the buffered lines when flushed, and the chunk is not written again when its write ends', () => {
    const sink = load();

    sink.log('info', ['a']);
    jest.advanceTimersByTime(100);
    sink.log('info', ['b']);
    sink.flush();
    finish.splice(0).forEach((done) => done(null, 2));

    expect(fs.writeSync.mock.calls.map(([, data, , , position]: [unknown, Buffer, unknown, unknown, number]) => [data.toString(), position])).toEqual([
      ['a\n', 10],
      ['b\n', 12],
    ]);
    expect(fs.write).toHaveBeenCalledTimes(1);
  });

  it('writes every line right away without a flush interval', () => {
    const sink = load(0);

    sink.log('error', ['a']);

    expect(fs.writeSync).toHaveBeenCalledTimes(1);
    expect(fs.write).not.toHaveBeenCalled();
  });

  it('starts writing right away once enough waits', () => {
    const sink = load();

    sink.log('info', ['x'.repeat(64 * 1024 + 1)]);

    expect(fs.write).toHaveBeenCalledTimes(1);
  });

  it('drops the lines, and says how many, once too much waits', () => {
    const sink = load();

    // the first write never finishes, so the rest piles up
    sink.log('info', ['x'.repeat(70 * 1024)]);
    sink.log('info', ['x'.repeat(17 * 1024 * 1024)]);
    sink.log('info', ['dropped']);
    sink.log('info', ['dropped']);
    finish.splice(0).forEach((done) => done(null, 70 * 1024 + 1));

    expect(consoleError).toHaveBeenCalledWith('Dropped 2 log lines, the disk does not keep up.');
  });

  it('does not keep the lines of a file that cannot be opened', () => {
    fs.openSync.mockImplementation(() => {
      throw new Error('denied');
    });
    const sink = load();

    sink.log('info', ['a']);
    jest.advanceTimersByTime(100);
    sink.flush();

    expect(consoleError).toHaveBeenCalledWith('Could not write log file of info:', expect.any(Error));
    expect(fs.write).not.toHaveBeenCalled();
    expect(fs.writeSync).not.toHaveBeenCalled();
  });
});
