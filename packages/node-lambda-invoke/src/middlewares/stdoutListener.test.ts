import { EventEmitter } from 'events';
import stdoutListener from './stdoutListener';
import type Lambda from '../classes/Lambda';

const createLambda = () => {
  const lambda = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), addEventListenerOnce: jest.fn() });
  return { lambda, instance: lambda as unknown as Lambda };
};

describe('stdoutListener', () => {
  it('logs what the lambda writes to stdout and to stderr, trimmed', () => {
    const logger = jest.fn();
    const { lambda, instance } = createLambda();
    stdoutListener(instance, logger);
    lambda.stdout.emit('data', Buffer.from('out\n'));
    lambda.stderr.emit('data', 'err\n');

    expect(logger.mock.calls).toEqual([[expect.stringMatching(/^\[.+\] out$/)], [expect.stringMatching(/^\[.+\] err$/)]]);
  });

  it('logs a failing exit code once the lambda closes, but not a clean one', () => {
    const logger = jest.fn();
    const { lambda, instance } = createLambda();
    stdoutListener(instance, logger);
    const [event, closeListener] = lambda.addEventListenerOnce.mock.calls[0];

    expect(event).toBe('close');

    closeListener(0);
    closeListener(null);

    expect(logger).not.toHaveBeenCalled();

    closeListener(2);

    expect(logger).toHaveBeenCalledWith(expect.stringContaining('exited with code 2'));
  });

  it('copes with a lambda without output streams, and with no logger', () => {
    const { lambda } = createLambda();
    const silent = Object.assign(lambda, { stdout: undefined, stderr: undefined }) as unknown as Lambda;

    expect(() => stdoutListener(silent)).not.toThrow();
  });
});
