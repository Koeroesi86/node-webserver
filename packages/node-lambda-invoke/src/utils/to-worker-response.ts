import type { ResponseEvent as WorkerResponseEvent } from '@koeroesi86/node-worker-pool';
import { MESSAGE_INTERNAL_SERVER_ERROR } from '../constants';
import type ResponseEvent from '../classes/ResponseEvent';
import createResponseHeaders from './create-response-headers';
import isValidResponse from './is-valid-response';

/** what API Gateway answers when the function gave no response it can pass on: a malformed proxy response */
const malformedResponse: WorkerResponseEvent = {
  statusCode: 502,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: MESSAGE_INTERNAL_SERVER_ERROR }),
};

/** the response of the handler as the worker protocol carries it, with the body as bytes and the headers merged, or the answer to a malformed response */
const toWorkerResponse = (response: ResponseEvent): WorkerResponseEvent => {
  if (!isValidResponse(response)) return malformedResponse;

  return {
    statusCode: response.statusCode,
    headers: createResponseHeaders(response),
    body: response.body ? Buffer.from(response.body, response.isBase64Encoded ? 'base64' : 'utf8') : undefined,
  };
};

export default toWorkerResponse;
