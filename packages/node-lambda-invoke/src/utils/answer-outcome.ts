import type { ServerResponse, IncomingMessage } from 'http';
import type { WorkerLease } from '@koeroesi86/node-worker-pool';
import { MESSAGE_ENDPOINT_TIMED_OUT, MESSAGE_INTERNAL_SERVER_ERROR } from '../constants';
import type { InvocationOutcome } from './invoke-lambda';
import writeError from './write-error';
import writeTooLarge from './write-too-large';

interface AnswerOutcomeParams {
  outcome: InvocationOutcome;
  request: IncomingMessage;
  response: ServerResponse;
  lease: WorkerLease;
}

/** Answers the client with what came of the invocation. A client that went away before the whole body arrived is not answered. */
const answerOutcome = ({ outcome, request, response, lease }: AnswerOutcomeParams) => {
  if (outcome.type === 'response') {
    response.writeHead(outcome.response.statusCode, outcome.response.headers);
    response.end(outcome.response.body);
  }
  if (outcome.type === 'closed') writeError(response, 502, MESSAGE_INTERNAL_SERVER_ERROR);
  if (outcome.type === 'tooLarge') writeTooLarge(request, response);
  if (outcome.type === 'timeout') {
    writeError(response, 504, MESSAGE_ENDPOINT_TIMED_OUT);
    // it is still busy with the request, and the pool lets go of it once it is gone
    lease.kill();
  }
};

export default answerOutcome;
