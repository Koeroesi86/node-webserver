import type { IncomingMessage, ServerResponse } from 'http';
import { WorkerAbandonedError, WorkerBusyError, WorkerStartError, WorkerUnavailableError } from '@koeroesi86/node-worker/pool';
import RequestBodyTooLargeError from '../classes/RequestBodyTooLargeError';
import answerFailure from './answer-failure';

const answer = (error: unknown, writable = true) => {
  const logger = jest.fn();
  const request = { destroy: jest.fn() } as unknown as IncomingMessage;
  const response = {
    writable,
    headersSent: false,
    writableEnded: false,
    setHeader: jest.fn(),
    once: jest.fn(),
    writeHead: jest.fn(),
    end: jest.fn(),
  } as unknown as ServerResponse;

  answerFailure({ error, request, response, logger });

  return { response, logger };
};

const statusOf = ({ response }: ReturnType<typeof answer>) => jest.mocked(response.writeHead).mock.calls[0]?.[0];

describe('answerFailure', () => {
  it('answers 503 when all the lambdas that may run are busy', () => {
    const answered = answer(new WorkerBusyError('/a.js', 'No worker became available.'));

    expect(statusOf(answered)).toBe(503);
    expect(answered.response.end).toHaveBeenCalledWith('{"message":"Service Unavailable"}');
  });

  it.each([[new WorkerUnavailableError('/a.js', 100)], [new WorkerStartError('/a.js', 'it exited with code 1')], [new Error('anything else')]])(
    'answers 502 when no lambda could be started (%s), and logs the reason',
    (error) => {
      const answered = answer(error);

      expect(statusOf(answered)).toBe(502);
      expect(answered.logger).toHaveBeenCalledWith(error);
    }
  );

  it('answers 413 to a body over the limit', () => {
    expect(statusOf(answer(new RequestBodyTooLargeError('too large')))).toBe(413);
  });

  it('does not answer a request whose client went away while it waited', () => {
    expect(statusOf(answer(new WorkerAbandonedError('/a.js')))).toBeUndefined();
  });

  it('does not answer a connection that is gone', () => {
    const answered = answer(new Error('The client went away before the body was complete.'), false);

    expect(statusOf(answered)).toBeUndefined();
    expect(answered.logger).not.toHaveBeenCalled();
  });
});
