import type { RequestEvent, WorkerLease } from '@koeroesi86/node-worker/pool';
import type { Request, Response } from 'express';
import type { ServeRequestOptions } from '../types/serve-request-options';
import createRequestHandOff from './create-request-hand-off';
import createResponseHandOff from './create-response-hand-off';

interface HandOffsParams {
  request: Request;
  response: Response;
  lease: WorkerLease;
  requestId: string;
  event: RequestEvent;
  /** the parts of the body are to be streamed, it did not arrive with the request */
  streamsBody: boolean;
  options: Pick<ServeRequestOptions, 'handOffRequests' | 'handOffResponses' | 'limitRequestBody' | 'limitResponseTimeout'>;
  /** the connection is the worker's now, the response timeout of the server does not apply any more */
  onHandedOver: () => void;
  /** the connection could not be given to the worker */
  onFailed: () => void;
}

/** The two ways to give the connection of a request to the worker, the response and the request with its body, which share what they need to know about the request. */
const createHandOffs = ({ request, response, lease, requestId, event, streamsBody, options, onHandedOver, onFailed }: HandOffsParams) => {
  const shared = { request, response, lease, requestId, streamsBody, timeout: options.limitResponseTimeout, onHandedOver, onFailed };

  return {
    handOff: createResponseHandOff({ ...shared, minimumLength: options.handOffResponses }),
    requestHandOff: createRequestHandOff({ ...shared, event, minimumLength: options.handOffRequests, limit: options.limitRequestBody }),
  };
};

export default createHandOffs;
