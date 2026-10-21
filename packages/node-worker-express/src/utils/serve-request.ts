import { Protocols, WORKER_EVENT, createBodyForwarder, type RequestEvent, type WorkerLease } from '@koeroesi86/node-worker/pool';
import type { Request, Response } from 'express';
import type { ServeRequestOptions } from '../types/serve-request-options';
import attachWebSocket from './attach-web-socket';
import createHandOffs from './create-hand-offs';
import isHandedOff from './is-handed-off';
import createResponseTimeout from './create-response-timeout';
import createWorkerMessageListener from './create-worker-message-listener';
import registerRequestListeners from './register-request-listeners';
import sendRequest from './send-request';
import writeTextResponse from './write-text-response';

interface ServeRequestParams {
  request: Request;
  response: Response;
  lease: WorkerLease;
  requestId: string;
  event: RequestEvent;
  /** a body that had arrived with the request, it goes along with it */
  inlineBody: Buffer | undefined;
  /** the parts of the body follow the request */
  streamsBody: boolean;
  /** frees the slot of a websocket connection */
  releaseSlot: () => void;
  options: ServeRequestOptions;
}

/** Hands a request to the worker of the lease and passes on what the worker answers, until the request is over and the worker and the slot are given back. */
const serveRequest = ({ request, response, lease, requestId, event, inlineBody, streamsBody, releaseSlot, options }: ServeRequestParams) => {
  const isSocketRequest = event.protocol === Protocols.websocket;
  /** what undoes the registrations of the request, run when it is over */
  const undo: Array<() => void> = [];
  const addUndo = (fn: () => void) => undo.push(fn);
  const webSocket = isSocketRequest ? attachWebSocket({ request, lease, requestId, event, options, onClose: cleanupConnection, addUndo }) : undefined;

  const failRequest = (statusCode: number, message: string) => {
    if (isSocketRequest) {
      request.socket.destroy();
    } else if (!response.headersSent) {
      writeTextResponse(response, statusCode, message);
    } else {
      response.destroy();
    }
    cleanupConnection();
  };

  // the response has to keep progressing, either by the worker answering or by the client taking what was written, as a streamed file can take longer than the timeout
  const responseTimeout = createResponseTimeout(event.protocol === Protocols.http ? options.limitResponseTimeout : undefined, () =>
    failRequest(504, 'Worker did not respond in time.')
  );

  const bodyForwarder = createBodyForwarder({
    request,
    lease,
    requestId,
    limit: options.limitRequestBody,
    onTooBig: () => {
      response.once('finish', () => request.socket.destroy());
      failRequest(413, 'Request body too large.');
    },
    onProgress: responseTimeout.arm,
  });

  const { handOff, requestHandOff } = createHandOffs({
    request,
    response,
    lease,
    requestId,
    event,
    streamsBody,
    options,
    onHandedOver: responseTimeout.clear,
    onFailed: () => failRequest(502, 'Worker could not take the connection.'),
  });

  const messageListener = createWorkerMessageListener({
    request,
    response,
    lease,
    requestId,
    webSocket,
    handOff,
    requestHandOff,
    armResponseTimeout: responseTimeout.arm,
    onBodyPartTaken: bodyForwarder.acknowledge,
    cleanup: () => cleanupConnection(),
  });

  function cleanupConnection() {
    responseTimeout.clear();
    // the response closed as the connection was handed over, the worker is still writing to it
    if (handOff.isActive() || requestHandOff.isActive()) return;
    if (event.protocol === Protocols.http && !response.writableFinished && !isHandedOff(response)) {
      // a worker that is streaming the response can stop
      lease.send({ type: WORKER_EVENT.REQUEST_ABORT, requestId });
    }
    lease.release();
    releaseSlot();
    undo.splice(0).forEach((fn) => fn());
  }

  registerRequestListeners({ request, response, event, streamsBody, bodyForwarder, cleanup: cleanupConnection, addUndo });
  lease.subscribe(requestId, messageListener, () => {
    // a worker that dies while it writes leaves the client with a truncated body, as when the body passes through here
    handOff.reset();
    requestHandOff.reset();
    failRequest(502, 'Worker exited.');
  });
  responseTimeout.arm();
  sendRequest({ request, lease, requestId, event, inlineBody, streamsBody, requestHandOff, bodyForwarder });
};

export default serveRequest;
