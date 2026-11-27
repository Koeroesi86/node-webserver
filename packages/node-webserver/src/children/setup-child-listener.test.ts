import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import createMockLogger from '../observability/mock-logger.test-helper';
import setupChildListener from './setup-child-listener';

const createChild = () => {
  const child = Object.assign(new EventEmitter(), { spawnfile: 'app', stdout: new EventEmitter(), stderr: new EventEmitter() });
  return { child, process: child as unknown as ChildProcess };
};

describe('setupChildListener', () => {
  const logger = createMockLogger();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs every line the child writes to stdout as info, with the time and the host in front of it', () => {
    const { child, process } = createChild();
    setupChildListener(process, 'app.localhost', logger);
    child.stdout.emit('data', Buffer.from('hello\nwor'));
    child.stdout.emit('data', Buffer.from('ld\n'));

    expect(logger.info.mock.calls).toEqual([
      [expect.stringMatching(/^\[[\d :.-]+\] \[app\.localhost\] hello$/)],
      [expect.stringMatching(/^\[[\d :.-]+\] \[app\.localhost\] world$/)],
    ]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs what the child writes to stderr as an error', () => {
    const { child, process } = createChild();
    setupChildListener(process, 'app.localhost', logger);
    child.stderr.emit('data', 'broken\n');

    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/^\[.+\] \[app\.localhost\] broken$/));
  });

  it('keeps the lines of stdout and stderr apart', () => {
    const { child, process } = createChild();
    setupChildListener(process, 'app.localhost', logger);
    child.stdout.emit('data', 'out');
    child.stderr.emit('data', 'err');
    child.stdout.emit('data', 'put\n');
    child.stderr.emit('data', 'or\n');

    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/ output$/));
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/ error$/));
  });

  it('logs what has no line break after it once the output ends', () => {
    const { child, process } = createChild();
    setupChildListener(process, 'app.localhost', logger);
    child.stdout.emit('data', 'bye');
    child.stderr.emit('data', 'crashed');
    child.stdout.emit('end');
    child.stderr.emit('end');

    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/ bye$/));
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/ crashed$/));
  });

  it('logs what waits for a line break when asked to, for a process that ends before the output does', () => {
    const { child, process } = createChild();
    const flush = setupChildListener(process, 'app.localhost', logger);
    child.stdout.emit('data', 'bye');
    child.stderr.emit('data', 'crashed');

    flush();

    expect(logger.info.mock.calls).toEqual([[expect.stringMatching(/ bye$/)]]);
    expect(logger.error.mock.calls).toEqual([[expect.stringMatching(/ crashed$/)]]);
  });

  it('does not log a line again when the output ends after it was asked for, and logs what comes later as a line of its own', () => {
    const { child, process } = createChild();
    const flush = setupChildListener(process, 'app.localhost', logger);
    child.stdout.emit('data', 'stopping');
    flush();
    child.stdout.emit('data', 'stopped');
    child.stdout.emit('end');

    expect(logger.info.mock.calls).toEqual([[expect.stringMatching(/ stopping$/)], [expect.stringMatching(/\] stopped$/)]]);
  });

  it('reads the output of a level that is off, without logging it', () => {
    const { child, process } = createChild();
    logger.isEnabled.mockImplementationOnce(() => false);
    setupChildListener(process, 'app.localhost', logger);

    expect(child.stdout.listenerCount('data')).toBe(1);
    child.stdout.emit('data', 'dropped\n');
    child.stdout.emit('end');
    child.stderr.emit('data', 'kept\n');

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('logs a failing exit code, and stays quiet about a clean exit', () => {
    const { child, process } = createChild();
    setupChildListener(process, 'app.localhost', logger);
    child.emit('close', 0);
    child.emit('close', null);

    expect(logger.error).not.toHaveBeenCalled();

    child.emit('close', 3);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[app.localhost] child process exited with code 3'));
  });

  it('logs why the command could not be started', () => {
    const { child, process } = createChild();
    const error = new Error('spawn app ENOENT');
    setupChildListener(process, 'app.localhost', logger);
    child.emit('error', error);

    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/^\[.+\] \[app\.localhost\] app could not be started:$/), error);
  });

  it('copes with a child without output streams', () => {
    expect(() => setupChildListener(new EventEmitter() as unknown as ChildProcess, 'app.localhost', logger)).not.toThrow();
  });

  it('does not log a line twice when the same child is set up twice', () => {
    const { child, process } = createChild();
    setupChildListener(process, 'app.localhost', logger);
    setupChildListener(process, 'app.localhost', logger);
    child.stdout.emit('data', 'once\n');
    child.emit('error', new Error('once'));

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
