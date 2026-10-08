import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import logger from './logger';
import setupChildListener from './setupChildListener';
import setupChildListeners from './setupChildListeners';
import type { ServerInstance } from '../types';

jest.mock('./logger', () => ({ __esModule: true, default: { info: jest.fn(), error: jest.fn() } }));

const createChild = () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  return { child, process: child as unknown as ChildProcess };
};

describe('setupChildListener', () => {
  beforeEach(() => {
    jest.mocked(logger.info).mockClear();
    jest.mocked(logger.error).mockClear();
  });

  it('logs what the child writes to stdout as info, trimmed', () => {
    const { child, process } = createChild();
    setupChildListener(process);
    child.stdout.emit('data', Buffer.from('hello\n'));

    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/^\[.+\] hello$/));
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs what the child writes to stderr as an error', () => {
    const { child, process } = createChild();
    setupChildListener(process);
    child.stderr.emit('data', 'broken\n');

    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/^\[.+\] broken$/));
  });

  it('logs a failing exit code, and stays quiet about a clean exit', () => {
    const { child, process } = createChild();
    setupChildListener(process);
    child.emit('close', 0);
    child.emit('close', null);

    expect(logger.error).not.toHaveBeenCalled();

    child.emit('close', 3);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('exited with code 3'));
  });

  it('copes with a child without output streams', () => {
    expect(() => setupChildListener(new EventEmitter() as unknown as ChildProcess)).not.toThrow();
  });

  it('does not log a line twice when the same child is set up twice', () => {
    const { child, process } = createChild();
    setupChildListener(process);
    setupChildListener(process);
    child.stdout.emit('data', 'once');

    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});

describe('setupChildListeners', () => {
  it('sets up the instances that have a child, and skips the others', () => {
    const { child, process } = createChild();
    const instances = [
      { hostname: 'a', protocol: 'http', child: process },
      { hostname: 'b', protocol: 'http' },
    ] satisfies ServerInstance[];

    setupChildListeners(instances);
    child.stderr.emit('data', 'x');
    setupChildListeners();

    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
