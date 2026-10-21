import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import createMockLogger from './mock-logger.test-helper';
import setupChildListener from './setup-child-listener';
import setupChildListeners from './setup-child-listeners';
import type { ServerState } from '../types';

const createChild = () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  return { child, process: child as unknown as ChildProcess };
};

describe('setupChildListener', () => {
  const logger = createMockLogger();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs what the child writes to stdout as info, trimmed', () => {
    const { child, process } = createChild();
    setupChildListener(process, logger);
    child.stdout.emit('data', Buffer.from('hello\n'));

    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/^\[.+\] hello$/));
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs what the child writes to stderr as an error', () => {
    const { child, process } = createChild();
    setupChildListener(process, logger);
    child.stderr.emit('data', 'broken\n');

    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/^\[.+\] broken$/));
  });

  it('logs a failing exit code, and stays quiet about a clean exit', () => {
    const { child, process } = createChild();
    setupChildListener(process, logger);
    child.emit('close', 0);
    child.emit('close', null);

    expect(logger.error).not.toHaveBeenCalled();

    child.emit('close', 3);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('exited with code 3'));
  });

  it('copes with a child without output streams', () => {
    expect(() => setupChildListener(new EventEmitter() as unknown as ChildProcess, logger)).not.toThrow();
  });

  it('does not log a line twice when the same child is set up twice', () => {
    const { child, process } = createChild();
    setupChildListener(process, logger);
    setupChildListener(process, logger);
    child.stdout.emit('data', 'once');

    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});

describe('setupChildListeners', () => {
  const logger = createMockLogger();

  it('sets up the instances that have a child, and skips the others', () => {
    const { child, process } = createChild();
    const instances = [
      { instance: { hostname: 'a', protocol: 'http' }, runtime: { child: process } },
      { instance: { hostname: 'b', protocol: 'http' }, runtime: {} },
    ] satisfies ServerState[];

    setupChildListeners(logger, instances);
    child.stderr.emit('data', 'x');
    setupChildListeners(logger);

    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
