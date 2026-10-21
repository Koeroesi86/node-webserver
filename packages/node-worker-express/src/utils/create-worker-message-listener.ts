import { WORKER_EVENT, type ResponseMessage, type WSMessage, type WorkerLease, type WorkerOutputEvent } from '@koeroesi86/node-worker/pool';
import type { Request, Response } from 'express';
import { WebSocketCloseCode } from '../constants';
import type createRequestHandOff from './create-request-hand-off';
import type createResponseHandOff from './create-response-hand-off';
import type createWsConnection from './create-ws-connection';
import { getServerMetrics } from './metrics';

interface WorkerMessageListenerParams {
  request: Request;
  response: Response;
  lease: WorkerLease;
  requestId: string;
  /** the connection of an upgrade request, once the worker accepted it it carries the messages */
  webSocket: ReturnType<typeof createWsConnection> | undefined;
  /** gives the connection to the worker when it asks for it */
  handOff: ReturnType<typeof createResponseHandOff>;
  /** the worker that was given the connection with the request tells when it is done with it */
  requestHandOff: ReturnType<typeof createRequestHandOff>;
  armResponseTimeout: () => void;
  /** the worker took a part of the request body */
  onBodyPartTaken: () => void;
  /** the request is over for the connection and the worker */
  cleanup: () => void;
}

/** What the server does with the messages a worker sends for one request. */
const createWorkerMessageListener = ({
  request,
  response,
  lease,
  requestId,
  webSocket,
  handOff,
  requestHandOff,
  armResponseTimeout,
  onBodyPartTaken,
  cleanup,
}: WorkerMessageListenerParams) => {
  const acknowledge = () => lease.send({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId });

  const respond = (event: ResponseMessage) => {
    // a plain response is not acknowledged: the worker does not wait for it, and every message is a write to the pipe of the worker
    // the upgrade was answered, what follows on the connection is not a response
    if (webSocket && response.headersSent) return;

    const body = event.body ?? Buffer.alloc(0);
    // the size is known, which spares the client a chunked answer and lets a compression middleware see how big it is
    const hasLength = Object.keys(event.headers ?? {}).some((name) => ['content-length', 'transfer-encoding'].includes(name.toLowerCase()));
    response.writeHead(event.statusCode, hasLength ? event.headers : { ...event.headers, 'Content-Length': body.length });
    response.write(body);
    response.end();

    if (webSocket && event.statusCode === 101) {
      webSocket.open();
      // the server closes a connection that stays quiet for its keep alive timeout once the response is done, which is not the idle time of a websocket
      response.once('finish', () => request.socket.setTimeout(0));
    } else if (webSocket) {
      // the upgrade was refused, the connection goes on as any other one and holds neither the worker nor the slot
      cleanup();
    }
  };

  // the worker has written the body to the client and ended the connection, it waits for the acknowledgement of the end
  const emitAfterHandOff = (event: ResponseMessage) => {
    if (event.body !== null) return;

    acknowledge();
    handOff.finish();
    cleanup();
  };

  const startHandOff = (event: Parameters<typeof handOff.start>[0] | undefined) => {
    if (event) void handOff.start(event);
  };

  const finishRequestHandOff = (event: Parameters<typeof requestHandOff.finish>[0] | undefined) => {
    if (event) requestHandOff.finish(event);
  };

  const emit = (event: ResponseMessage) => {
    if (handOff.isActive()) return emitAfterHandOff(event);

    if (!response.headersSent) response.writeHead(event.statusCode, event.headers);

    if (event.body === null) {
      response.end();
      acknowledge();
      return;
    }

    // the worker waits for the acknowledgement before it goes on, so a slow client slows the worker down instead of filling the memory
    response.write(event.body ?? Buffer.alloc(0), () => {
      acknowledge();
      armResponseTimeout();
    });
  };

  const sendToClient = ({ body, close }: WSMessage) => {
    // the worker sends the next message once this one was written, which a slow client delays
    if (body !== undefined) webSocket?.send(body, (written) => written && acknowledge());
    if (close) webSocket?.close(close.code ?? WebSocketCloseCode.normal, close.reason);
  };

  return (responseEvent: WorkerOutputEvent) => {
    armResponseTimeout();

    switch (responseEvent.type) {
      case WORKER_EVENT.METRICS_REQUEST:
        lease.send({ type: WORKER_EVENT.METRICS, requestId, event: getServerMetrics() });
        break;
      case WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE:
        onBodyPartTaken();
        break;
      case WORKER_EVENT.RESPONSE:
        respond(responseEvent.event);
        break;
      case WORKER_EVENT.RESPONSE_EMIT:
        emit(responseEvent.event);
        break;
      case WORKER_EVENT.RESPONSE_HANDOFF:
        startHandOff(responseEvent.event);
        break;
      case WORKER_EVENT.REQUEST_HANDOFF_DONE:
        finishRequestHandOff(responseEvent.event);
        cleanup();
        break;
      case WORKER_EVENT.WS_MESSAGE_ACKNOWLEDGE:
        webSocket?.acknowledge();
        break;
      case WORKER_EVENT.WS_MESSAGE_SEND:
        sendToClient(responseEvent.event);
        break;
    }
  };
};

export default createWorkerMessageListener;
