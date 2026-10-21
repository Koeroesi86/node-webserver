import type { InvokableWorker } from '@koeroesi86/node-worker/pool';
import { DEFAULT_TIMEOUT } from '../constants';
import createContext from './create-context';
import createLambdaEvent from './create-lambda-event';
import readBodyStream from './read-body-stream';
import runHandler from './run-handler';
import toWorkerResponse from './to-worker-response';
import type findHandler from './find-handler';

/** The worker of a lambda: calls the handler with the event of API Gateway made from the request, and answers with its response. The pool makes sure it gets one request at a time. */
const createLambdaWorker =
  (found: NonNullable<ReturnType<typeof findHandler>>): InvokableWorker =>
  async (event, callback) => {
    // a request that is aborted while its body arrives, as when the client goes away, is not invoked and not answered: nobody waits for it
    const body = await readBodyStream(event.bodyStream).then(
      (bytes) => ({ bytes }),
      () => undefined
    );
    if (body === undefined) return;

    const { requestId, deadline = Date.now() + DEFAULT_TIMEOUT } = event;
    const response = await runHandler(found, createLambdaEvent(event, body.bytes), (done) => createContext(requestId, deadline, done));

    callback(toWorkerResponse(response));
  };

export default createLambdaWorker;
