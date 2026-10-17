import type { WORKER_EVENT } from '../constants';
import type { ServerMetrics } from '../utils/metrics';
import type { RequestBodyEvent, RequestEvent, RequestMessage } from './request';
import type { ResponseMessage, WSMessage } from './response';

export type WorkerInputEvent =
  | {
      type: WORKER_EVENT.WS_MESSAGE_RECEIVE;
      requestId: string;
      /** the message of the client travels as the body: a string is a text message, a Buffer a binary one. The rest of the event is what the request was. */
      event: { body: Buffer | string };
    }
  | {
      type: WORKER_EVENT.REQUEST_BODY;
      requestId: string;
      event: RequestBodyEvent;
    }
  | {
      type: WORKER_EVENT.METRICS;
      requestId: string;
      event: ServerMetrics;
    }
  | {
      type: WORKER_EVENT.REQUEST;
      requestId: string;
      event: RequestMessage;
    }
  | {
      type: Exclude<WORKER_EVENT, WORKER_EVENT.REQUEST | WORKER_EVENT.REQUEST_BODY | WORKER_EVENT.METRICS | WORKER_EVENT.WS_MESSAGE_RECEIVE>;
      requestId: string;
      event?: RequestEvent;
    };

export type WorkerOutputEvent =
  | {
      type: Exclude<WORKER_EVENT, WORKER_EVENT.WS_MESSAGE_SEND>;
      requestId: string;
      event?: ResponseMessage;
    }
  | {
      type: WORKER_EVENT.WS_MESSAGE_SEND;
      requestId: string;
      event: WSMessage;
    };

/** what goes along with the connection of a client that is handed to a worker to write a big response, over the IPC channel */
export type ResponseHandOffMessage = {
  type: WORKER_EVENT.RESPONSE_HANDOFF;
  requestId: string;
  /** how long the client may take nothing before the worker closes the connection, in milliseconds, 0 for no limit */
  timeout: number;
  /** the head says that the connection goes on, so the worker gives it back after the body: the client wants it kept, and the server still accepts connections */
  keepAlive: boolean;
};

/** what the worker sends along with the connection of a client that it wrote a big response to, when it goes back to the server, over the IPC channel */
export type ResponseHandBackMessage = {
  type: WORKER_EVENT.RESPONSE_HANDBACK;
  requestId: string;
  /** what the worker read from the connection, as base64 as the IPC channel carries JSON */
  leftover: string;
};

export type HandBackMessage = RequestHandBackMessage | ResponseHandBackMessage;

/** what goes along with the connection of a client that is handed to a worker to read a big request body and answer it, over the IPC channel */
export type RequestHandOffMessage = {
  type: WORKER_EVENT.REQUEST_HANDOFF;
  requestId: string;
  /** the request, without its body */
  event: RequestEvent;
  /** the part of the body that had arrived already, as base64 as the IPC channel carries JSON */
  prefix: string;
  /** the length of the whole body in bytes, by its `Content-Length` */
  length: number;
  /** how long the client may take nothing before the worker closes the connection, in milliseconds, 0 for no limit */
  timeout: number;
  /** the connection may be handed back after the response: the client wants it kept, nothing follows the body on it, and the server still accepts connections */
  keepAlive: boolean;
};

/** what the worker sends along with the connection of a handed over request that goes back to the server, over the IPC channel */
export type RequestHandBackMessage = {
  type: WORKER_EVENT.REQUEST_HANDBACK;
  requestId: string;
  /** how the response went, as the message of a closed connection says it */
  event: ResponseMessage;
  /** what the worker read from the connection after the body, as base64 as the IPC channel carries JSON */
  leftover: string;
};

export type HandOffMessage = ResponseHandOffMessage | RequestHandOffMessage;
