import Worker from './Worker';
import { spawn } from 'child_process';

jest.mock('child_process');
const mockedSpawn = jest.mocked(spawn);

describe('Worker', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should spawn process', () => {
    new Worker('ls', { stdio: 'inherit' });
    expect(mockedSpawn).toHaveBeenNthCalledWith(1, 'ls', [], { stdio: 'inherit' });
  });

  it('should support addEventListener', () => {
    const listener = jest.fn();
    const event = 'example-event';

    const worker = new Worker('ls', { stdio: 'inherit' });
    worker.addEventListener('example-event', listener);

    expect(worker.instance.on).toHaveBeenNthCalledWith(1, event, listener);
  });

  it('should support removeEventListener', () => {
    const listener = jest.fn();
    const event = 'example-event';

    const worker = new Worker('ls', { stdio: 'inherit' });
    worker.removeEventListener('example-event', listener);

    expect(worker.instance.off).toHaveBeenNthCalledWith(1, event, listener);
  });

  it('should support dispatchEvent', () => {
    const event = Object.assign(new Event('example-event'), { payload: { foo: 'bar' } });

    const worker = new Worker('ls', { stdio: 'inherit' });
    worker.dispatchEvent(event);

    expect(worker.instance.emit).toHaveBeenNthCalledWith(1, event.type, event.payload);
  });

  it('should support onmessage', () => {
    const listener = jest.fn();

    const worker = new Worker('ls', { stdio: 'inherit' });
    worker.onmessage = listener;

    expect(worker.instance.on).toHaveBeenNthCalledWith(1, 'message', listener);
  });

  it('should support onerror', () => {
    const listener = jest.fn();

    const worker = new Worker('ls', { stdio: 'inherit' });
    worker.onerror = listener;

    expect(worker.instance.on).toHaveBeenNthCalledWith(1, 'error', listener);
  });

  it('should support postMessage', () => {
    const message = { foo: 'bar' };
    const callback = jest.fn();

    const worker = new Worker('ls', { stdio: 'inherit' });
    worker.postMessage(message, callback);

    expect(worker.instance.send).toHaveBeenNthCalledWith(1, message, callback);
  });

  it('should support terminate', () => {
    const message = { foo: 'bar' };

    const worker = new Worker('ls', { stdio: 'inherit' });
    worker.terminate();

    expect(worker.instance.kill).toHaveBeenNthCalledWith(1, 'SIGINT');
  });

  it('should send the signal it is given', () => {
    const worker = new Worker('ls', { stdio: 'inherit' });
    worker.terminate('SIGKILL');

    expect(worker.instance.kill).toHaveBeenNthCalledWith(1, 'SIGKILL');
  });

  it('should not signal a process that is gone', () => {
    const worker = new Worker('ls', { stdio: 'inherit' });
    Object.assign(worker.instance, { signalCode: 'SIGKILL' });
    worker.terminate();

    expect(worker.exited).toBe(true);
    expect(worker.instance.kill).not.toHaveBeenCalled();
    Object.assign(worker.instance, { signalCode: null });
  });

  it('should place the flags right after the executable', () => {
    new Worker('node file.js', { execArgv: ['--permission', '--allow-fs-write=/tmp/a b'], stdio: 'inherit' });

    expect(mockedSpawn).toHaveBeenNthCalledWith(1, 'node', ['--permission', '--allow-fs-write=/tmp/a b', 'file.js'], { stdio: 'inherit' });
  });

  it('should not split a command that is given as parts', () => {
    new Worker(['node', '/path with spaces/file.js']);

    expect(mockedSpawn).toHaveBeenNthCalledWith(1, 'node', ['/path with spaces/file.js'], {});
  });

  it('should expose the output of the process', () => {
    const worker = new Worker('ls');

    expect(worker.stdout).toBe(worker.instance.stdout);
    expect(worker.stderr).toBe(worker.instance.stderr);
  });
});
