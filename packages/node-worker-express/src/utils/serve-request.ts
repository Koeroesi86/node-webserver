import type { Request, Response } from 'express';
import { Protocols, WORKER_EVENT } from '../constants';
import type { MiddlewareOptions, RequestEvent } from '../types';
import createBodyForwarder from './create-body-forwarder';
import createRequestHandOff from './create-request-hand-off';
import createResponseHandOff from './create-response-hand-off';
import isHandedOff from './is-handed-off';
import createResponseTimeout from './create-response-timeout';
import createWorkerMessageListener from './create-worker-message-listener';
import createWsConnection from './create-ws-connection';
import writeTextResponse from './write-text-response';
import type { WorkerLease } from './workerPool';

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
  const webSocket = isSocketRequest
    ? createWsConnection(request.socket, {
        limitMessage: options.limitWebSocketMessage,
        pingInterval: options.webSocketPingInterval,
        idleTimeout: options.limitWebSocketIdleTimeout,
        // the message travels as the body, which spares encoding it: a string is a text message, a Buffer a binary one
        onMessage: (data) => lease.send({ type: WORKER_EVENT.WS_MESSAGE_RECEIVE, requestId, event: { body: data } }),
      })
    : undefined;
  if (webSocket) {
    request.socket.on('data', webSocket.receive);
  }

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

  const requestCloseListener = () => {
    lease.send({
      type: WORKER_EVENT.WS_CONNECTION_CLOSE,
      requestId,
      event,
    });
    cleanupConnection();
  };
  if (webSocket) {
    request.socket.on('close', requestCloseListener);
  }

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
    webSocket?.dispose();
    if (streamsBody) {
      // what is still to come of the body is read and dropped, a request that is not read keeps its connection stuck
      request.off('data', bodyForwarder.part);
      request.off('end', bodyForwarder.end);
      request.resume();
    }
    if (request && request.off) {
      request.off('aborted', cleanupConnection);
    }
    response.off('close', cleanupConnection);

    if (request.socket && request.socket.off) {
      if (webSocket) request.socket.off('data', webSocket.receive);
      request.socket.off('close', requestCloseListener);
    }
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

  request.on('aborted', cleanupConnection);
  if (event.protocol === Protocols.http) {
    // the close of the response, as the request closes as soon as its body was read, which says nothing about the client being gone
    response.on('close', cleanupConnection);
    response.on('finish', cleanupConnection);
  }
};

export default serveRequest;
