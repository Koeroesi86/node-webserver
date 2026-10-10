import { WORKER_EVENT } from '../constants';
import { Request, Response } from 'express';
import type { Readable } from 'stream';
import type { ServerMetrics } from '../utils/metrics';

export type RequestEvent = {
  httpMethod: string;
  protocol: string;
  path: string;
  pathFragments: string[];
  /** a parameter given more than once is an array */
  queryStringParameters: { [key: string]: string | string[] };
  headers: { [key: string]: string };
  remoteAddress: string;
  rootPath: string;
  closed?: boolean;
  /** the text message of a websocket client */
  frame?: string;
  /** the binary message of a websocket client */
  binaryFrame?: Buffer;
  /** the request has a body, which follows in parts. Without one `bodyStream` is empty. */
  hasBody?: boolean;
  /** the whole body as base64, when it had arrived with the request and was small. No parts follow then, `bodyStream` holds it. */
  inlineBody?: string;
};

/**
 * What a worker is called with: the request, the stream to read its body from, and a way to ask for the metrics of the server.
 * The body is not part of the request, it is read as it arrives. Read it before answering, once the response is complete the rest is dropped.
 */
export type WorkerRequestEvent = RequestEvent & {
  /** the body of the request, empty for requests that have none. It ends with an error when the client goes away. */
  bodyStream: Readable;
  /** a snapshot of the server: uptime, memory, event loop delay, requests, worker pools and what else registered itself */
  getMetrics: () => Promise<ServerMetrics>;
};

/** a part of a streamed request body as it travels to the worker, `null` ends it */
export type RequestBodyEvent = { body: Buffer | null };

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
      type: Exclude<WORKER_EVENT, WORKER_EVENT.REQUEST_BODY | WORKER_EVENT.METRICS | WORKER_EVENT.WS_MESSAGE_RECEIVE>;
      requestId: string;
      event?: RequestEvent;
    };

/** a response as it travels from the worker to the server: the body is raw bytes, and null ends a streamed response */
export type ResponseMessage = Omit<ResponseEvent, 'body' | 'isBase64Encoded'> & { body?: Buffer | null };

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

export type ResponseEvent = {
  statusCode: number;
  headers?: { [key: string]: string };
  /** whether a string `body` is base64, ignored for a Buffer */
  isBase64Encoded?: boolean;
  emit?: boolean;
  /** a Buffer is sent as it is, a string is utf8 unless `isBase64Encoded`, and null ends a streamed response */
  body?: string | Buffer | null;
};

/**
 * What a worker sends to a websocket client: a message, or the end of the connection. A string `frame` is sent as a text message, a Buffer as a binary one.
 * The promise `callback` returns resolves when the message was written to the client (`true`), or when the connection is gone (`false`).
 * A worker that sends faster than the client takes waits for it, so the memory stays flat.
 */
export type WSFrameEvent = {
  sendWsMessage: boolean;
  frame?: string | Buffer;
  /** closes the connection after the messages sent before, `code` defaults to 1000 */
  close?: { code?: number; reason?: string };
};

/** a message to a websocket client as it travels from the worker to the server: the body is a text message when it is a string and a binary one when it is a Buffer */
export type WSMessage = {
  body?: Buffer | string;
  close?: { code?: number; reason?: string };
};

/**
 * Answers the request. A response with `emit` streams the body in parts, ending with a part without a body.
 * For those the returned promise resolves when the part was written to the client: `true` to go on, `false` when the client is gone and streaming should stop.
 */
export type ResponseCallback = (e: ResponseEvent) => unknown;

/** The function a worker file exports. */
export type InvokableWorker = (event: WorkerRequestEvent, callback: ResponseCallback) => unknown;

export interface MiddlewareOptions {
  root: string;
  /** names the worker pool in the metrics, as `workers:<name>`. Defaults to the root folder. */
  name?: string;
  limit?: number;
  /** workers started per path, requests are spread over them. Defaults to the available CPU cores, 0 or 1 keeps a single worker. */
  limitPerPath?: number | ((path: string) => number);
  /** start a worker for static files when the middleware is created, so the first request for a file does not wait for a process to start. Defaults to true. */
  warmStaticWorker?: boolean;
  /**
   * a request body that has arrived with the request, and is not bigger than this many bytes, is sent to the worker along with the request, which saves the messages for its parts.
   * Bigger ones, and ones that arrive later, are streamed. 0 streams all. Defaults to 65536.
   */
  inlineRequestBody?: number;
  /** the largest request body in bytes, a bigger one is answered with 413. 0 for no limit, which is the default. The body is streamed to the worker, so it is never held in memory. */
  limitRequestBody?: number;
  /** how long a request may wait for a worker when none can be started, in milliseconds, then it is answered with 503 */
  limitRequestTimeout?: number;
  /** how long the worker may stay silent while answering an HTTP request before it is answered with 504, 0 disables it */
  limitResponseTimeout?: number;
  /** @deprecated nothing polls for a worker any more, requests that wait are woken when one is free. Has no effect. */
  idleCheckTimeout?: number;
  /**
   * how many requests may wait for a worker of a server (when the workers are all busy and no more can be started), the next ones are answered with 503 at once instead of waiting
   * for the time they would be given (`limitRequestTimeout`). 0 for no limit. Defaults to 1000.
   */
  limitQueue?: number;
  /** the largest websocket message in bytes (also of one frame), a client that sends a bigger one is closed with 1009. 0 for no limit. Defaults to 1 MiB. */
  limitWebSocketMessage?: number;
  /** how many websocket connections a worker file may have at the same time, the next ones are answered with 503. 0 for no limit. Defaults to 1000. */
  limitWebSocketConnections?: number;
  /** how often an idle websocket connection is pinged, in milliseconds. 0 for no pings. Defaults to 30000. */
  webSocketPingInterval?: number;
  /** a websocket connection that sent nothing (not even an answer to a ping) for this long, in milliseconds, is closed. 0 for never. Defaults to 90000. */
  limitWebSocketIdleTimeout?: number;
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
  onExit?: (code: number, workerPath: string, id: string) => void;
  onForbiddenPath?: (request: Request, response: Response) => unknown;
  index?: string[];
  env?: object;
  staticWorker?: string;
  cwd?: string;
}

export type StreamBody = Readable | AsyncIterable<Buffer | Uint8Array | string>;

export interface StreamResponseOptions {
  statusCode?: number;
  headers?: ResponseEvent['headers'];
  /** how many parts may wait to be written to the client while the next ones are produced. Not limited by default. */
  window?: number;
  /** how many bytes may wait to be written to the client while the next ones are produced, so the pipe stays full. Defaults to 4 MiB. */
  windowBytes?: number;
}
