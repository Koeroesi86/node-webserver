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
};

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
};

export type HandOffMessage = ResponseHandOffMessage | RequestHandOffMessage;
