import { Protocols, WORKER_EVENT, createBodyForwarder, type RequestEvent, type WorkerLease } from '@koeroesi86/node-worker-pool';
import type { Request, Response } from 'express';
import type { MiddlewareOptions } from '../types';
import attachWebSocket from './attach-web-socket';
import createRequestHandOff from './create-request-hand-off';
import createResponseHandOff from './create-response-hand-off';
import isHandedOff from './is-handed-off';
import createResponseTimeout from './create-response-timeout';
import createWorkerMessageListener from './create-worker-message-listener';
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
  options: Pick<
    MiddlewareOptions,
    | 'handOffRequests'
    | 'handOffResponses'
    | 'limitRequestBody'
    | 'limitResponseTimeout'
    | 'limitWebSocketMessage'
    | 'webSocketPingInterval'
    | 'limitWebSocketIdleTimeout'
  >;
}

/** Hands a request to the worker of the lease and passes on what the worker answers, until the request is over and the worker and the slot are given back. */
const serveRequest = ({ request, response, lease, requestId, event, inlineBody, streamsBody, releaseSlot, options }: ServeRequestParams) => {
  const isSocketRequest = event.protocol === Protocols.websocket;
  /** what undoes the registrations of the request, run when it is over */
  const undo: Array<() => void> = [];
  const webSocket = isSocketRequest
    ? attachWebSocket({ request, lease, requestId, event, options, onClose: cleanupConnection, addUndo: (fn) => undo.push(fn) })
    : undefined;

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

  const handOff = createResponseHandOff({
    request,
    response,
    lease,
    requestId,
    streamsBody,
    minimumLength: options.handOffResponses,
    timeout: options.limitResponseTimeout,
    onHandedOver: responseTimeout.clear,
    onFailed: () => failRequest(502, 'Worker could not take the connection.'),
  });

  const requestHandOff = createRequestHandOff({
    request,
    response,
    lease,
    requestId,
    event,
    streamsBody,
    minimumLength: options.handOffRequests,
    limit: options.limitRequestBody,
    timeout: options.limitResponseTimeout,
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

  request.on('aborted', cleanupConnection);
  undo.push(() => request.off('aborted', cleanupConnection));
  if (streamsBody) {
    undo.push(() => {
      // what is still to come of the body is read and dropped, a request that is not read keeps its connection stuck
      request.off('data', bodyForwarder.part);
      request.off('end', bodyForwarder.end);
      request.resume();
    });
  }
  if (event.protocol === Protocols.http) {
    // the close of the response, as the request closes as soon as its body was read, which says nothing about the client being gone
    response.on('close', cleanupConnection);
    response.on('finish', cleanupConnection);
    undo.push(() => response.off('close', cleanupConnection));
  }

  lease.subscribe(requestId, messageListener, () => {
    // a worker that dies while it writes leaves the client with a truncated body, as when the body passes through here
    handOff.reset();
    requestHandOff.reset();
    failRequest(502, 'Worker exited.');
  });
  responseTimeout.arm();
  if (requestHandOff.isAllowed()) {
    void requestHandOff.start();
  } else {
    lease.send({
      type: WORKER_EVENT.REQUEST,
      requestId,
      // a body that goes along travels as the bytes of the frame, which spares encoding it as base64 and decoding it in the worker
      event: inlineBody === undefined ? event : { ...event, body: inlineBody },
    });

    if (streamsBody) {
      request.on('data', bodyForwarder.part);
      request.once('end', bodyForwarder.end);
    }
  }
};

export default serveRequest;
