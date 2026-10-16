import type { Request } from 'express';
import { WORKER_EVENT } from '../constants';
import type { MiddlewareOptions, RequestEvent } from '../types';
import createWsConnection from './create-ws-connection';
import type { WorkerLease } from './workerPool';

interface AttachWebSocketParams {
  request: Request;
  lease: WorkerLease;
  requestId: string;
  event: RequestEvent;
  options: Pick<MiddlewareOptions, 'limitWebSocketMessage' | 'webSocketPingInterval' | 'limitWebSocketIdleTimeout'>;
  /** called when the client closes the connection */
  onClose: () => void;
  /** takes what undoes a registration, to be run at the cleanup of the request */
  addUndo: (undo: () => void) => void;
}

/** Reads the websocket connection of the client and tells the worker about its messages and its close. */
const attachWebSocket = ({ request, lease, requestId, event, options, onClose, addUndo }: AttachWebSocketParams) => {
  const webSocket = createWsConnection(request.socket, {
    limitMessage: options.limitWebSocketMessage,
    pingInterval: options.webSocketPingInterval,
    idleTimeout: options.limitWebSocketIdleTimeout,
    // the message travels as the body, which spares encoding it: a string is a text message, a Buffer a binary one
    onMessage: (data) => lease.send({ type: WORKER_EVENT.WS_MESSAGE_RECEIVE, requestId, event: { body: data } }),
  });
  const closeListener = () => {
    lease.send({ type: WORKER_EVENT.WS_CONNECTION_CLOSE, requestId, event });
    onClose();
  };

  request.socket.on('data', webSocket.receive);
  request.socket.on('close', closeListener);
  addUndo(webSocket.dispose);
  addUndo(() => request.socket.off('data', webSocket.receive));
  addUndo(() => request.socket.off('close', closeListener));

  return webSocket;
};

export default attachWebSocket;
