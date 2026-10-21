import type { IncomingMessage, ServerResponse } from 'http';
import type { WorkerLease } from '@koeroesi86/node-worker/pool';
import answerOutcome from './answer-outcome';
import type { InvocationOutcome } from './invoke-lambda';

const answer = (outcome: InvocationOutcome) => {
  const request = { destroy: jest.fn() } as unknown as IncomingMessage;
  const response = {
    headersSent: false,
    writableEnded: false,
    setHeader: jest.fn(),
    once: jest.fn(),
    writeHead: jest.fn(),
    end: jest.fn(),
  } as unknown as ServerResponse;
  const lease = { kill: jest.fn() } as unknown as WorkerLease;

  answerOutcome({ outcome, request, response, lease });

  return { response, lease };
};

describe('answerOutcome', () => {
  it('writes the response of the lambda', () => {
    const { response, lease } = answer({ type: 'response', response: { statusCode: 201, headers: { 'x-a': ['1', '2'] }, body: Buffer.from('made') } });

    expect(response.writeHead).toHaveBeenCalledWith(201, { 'x-a': ['1', '2'] });
    expect(response.end).toHaveBeenCalledWith(Buffer.from('made'));
    expect(lease.kill).not.toHaveBeenCalled();
  });

  it('ends a response without a body', () => {
    expect(answer({ type: 'response', response: { statusCode: 204 } }).response.end).toHaveBeenCalledWith(undefined);
  });

  it('answers 502 when the lambda exited during the request', () => {
    const { response } = answer({ type: 'closed' });

    expect(response.writeHead).toHaveBeenCalledWith(502, { 'Content-Type': 'application/json' });
    expect(response.end).toHaveBeenCalledWith('{"message":"Internal server error"}');
  });

  it('answers 504 and kills the lambda that did not answer in time, as it is busy with the request', () => {
    const { response, lease } = answer({ type: 'timeout' });

    expect(response.writeHead).toHaveBeenCalledWith(504, { 'Content-Type': 'application/json' });
    expect(response.end).toHaveBeenCalledWith('{"message":"Endpoint request timed out"}');
    expect(lease.kill).toHaveBeenCalledTimes(1);
  });

  it('answers 413 to a body over the limit', () => {
    expect(answer({ type: 'tooLarge' }).response.writeHead).toHaveBeenCalledWith(413, expect.anything());
  });

  it('does not answer a client that went away', () => {
    const { response } = answer({ type: 'abandoned' });

    expect(response.writeHead).not.toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();
  });
});
