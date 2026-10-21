import { WorkerAbandonedError, WorkerUnavailableError } from '@koeroesi86/node-worker/pool';
import type { Response } from 'express';
import handleRequestError from './handle-request-error';

const createResponse = (headersSent = false) =>
  ({ headersSent, writeHead: jest.fn(), end: jest.fn() }) as never as Response & { writeHead: jest.Mock; end: jest.Mock };

describe('handleRequestError', () => {
  it('stays silent for an abandoned request', () => {
    const response = createResponse();
    const next = jest.fn();

    handleRequestError(new WorkerAbandonedError('/a.js'), response, next);

    expect(response.writeHead).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('answers 503 with the seconds to wait, rounded up, without the details', () => {
    const response = createResponse();

    handleRequestError(new WorkerUnavailableError('/secret/a.js', 2500), response, jest.fn());

    expect(response.writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'text/plain', 'Retry-After': 3 });
    expect(response.end).toHaveBeenCalledWith('Service unavailable.');
  });

  it('asks to wait at least a second', () => {
    const response = createResponse();

    handleRequestError(new WorkerUnavailableError('/a.js', 10), response, jest.fn());

    expect(response.writeHead).toHaveBeenCalledWith(503, expect.objectContaining({ 'Retry-After': 1 }));
  });

  it('passes on an unavailable worker when the answer has started', () => {
    const error = new WorkerUnavailableError('/a.js', 1000);
    const next = jest.fn();

    handleRequestError(error, createResponse(true), next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('passes on any other error', () => {
    const error = new Error('broken');
    const response = createResponse();
    const next = jest.fn();

    handleRequestError(error, response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(response.writeHead).not.toHaveBeenCalled();
  });
});
