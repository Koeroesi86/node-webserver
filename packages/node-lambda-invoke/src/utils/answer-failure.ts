import type { IncomingMessage, ServerResponse } from 'http';
import { WorkerAbandonedError, WorkerBusyError } from '@koeroesi86/node-worker/pool';
import { RequestBodyTooLargeError } from '../classes';
import { MESSAGE_INTERNAL_SERVER_ERROR, MESSAGE_SERVICE_UNAVAILABLE } from '../constants';
import type { Logger } from '../types';
import writeError from './write-error';
import writeTooLarge from './write-too-large';

interface AnswerFailureParams {
  error: unknown;
  request: IncomingMessage;
  response: ServerResponse;
  logger: Logger;
}

/** Answers the way API Gateway does when the request could not be given to a lambda: 413 for a body over the limit, 503 when all lambdas are busy, 502 when none could be started. A client that went away is not answered. */
const answerFailure = ({ error, request, response, logger }: AnswerFailureParams) => {
  if (error instanceof WorkerAbandonedError) return;

  if (error instanceof RequestBodyTooLargeError) {
    writeTooLarge(request, response);
    return;
  }

  // the client went away halfway through the body, there is nobody to answer
  if (!response.writable) return;

  logger(error);
  if (error instanceof WorkerBusyError) writeError(response, 503, MESSAGE_SERVICE_UNAVAILABLE);
  else writeError(response, 502, MESSAGE_INTERNAL_SERVER_ERROR);
};

export default answerFailure;
