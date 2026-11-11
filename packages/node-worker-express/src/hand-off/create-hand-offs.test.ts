import type { RequestEvent, WorkerLease } from '@koeroesi86/node-worker/pool';
import type { Request, Response } from 'express';
import createHandOffs from './create-hand-offs';
import createRequestHandOff from './create-request-hand-off';
import createResponseHandOff from './create-response-hand-off';

jest.mock('./create-request-hand-off', () => ({ __esModule: true, default: jest.fn(() => ({ name: 'request' })) }));
jest.mock('./create-response-hand-off', () => ({ __esModule: true, default: jest.fn(() => ({ name: 'response' })) }));

describe('createHandOffs', () => {
  const params = {
    request: {} as Request,
    response: {} as Response,
    lease: {} as WorkerLease,
    requestId: 'r1',
    event: {} as RequestEvent,
    streamsBody: true,
    options: { handOffRequests: 10, handOffResponses: 20, limitRequestBody: 30, limitResponseTimeout: 40 },
    onHandedOver: jest.fn(),
    onFailed: jest.fn(),
  };
  const { options, event, ...shared } = params;

  it('gives the response hand-off its own minimum length and the shared request', () => {
    const { handOff } = createHandOffs(params);

    expect(handOff).toEqual({ name: 'response' });
    expect(createResponseHandOff).toHaveBeenCalledWith({ ...shared, timeout: 40, minimumLength: 20 });
  });

  it('gives the request hand-off its own minimum length, the body limit and the event', () => {
    const { requestHandOff } = createHandOffs(params);

    expect(requestHandOff).toEqual({ name: 'request' });
    expect(createRequestHandOff).toHaveBeenCalledWith({ ...shared, event, timeout: 40, minimumLength: 10, limit: 30 });
  });
});
