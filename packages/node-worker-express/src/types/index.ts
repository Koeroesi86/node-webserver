import type { WORKER_EVENT } from '../constants';
import { Request, RequestHandler, Response } from 'express';
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
  /** the named groups of the route the path matched, as they are in the path (not decoded). Only set for a request that matched a route with named groups. */
  pathParameters?: { [key: string]: string };
  closed?: boolean;
  /** the text message of a websocket client */
  frame?: string;
  /** the binary message of a websocket client */
  binaryFrame?: Buffer;
  /** the request has a body, which follows in parts. Without one `bodyStream` is empty. */
  hasBody?: boolean;
  /** the whole body as base64, when it had arrived with the request and was small. No parts follow then, `bodyStream` holds it. Only a worker gets it, encoded when read. */
  inlineBody?: string;
};

/** a request as it travels to the worker: the body travels as raw bytes, when it had arrived with the request and was small. No parts follow then, `bodyStream` holds it. */
export type RequestMessage = RequestEvent & { body?: Buffer };

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

/** how long requests took, from the request to the close of its response, since the server started */
export type LatencySnapshot = {
  count: number;
  sumMs: number;
  maxMs: number;
  /** the upper bound of the bucket the percentile falls into, or `maxMs` above the last bucket. Zero without requests. */
  p50: number;
  p90: number;
  p99: number;
  /** the number of requests per bucket, by its upper bound in milliseconds, and `+Inf` for the slower ones. Not cumulative. */
  buckets: Record<string, number>;
};

export interface LatencyHistogram {
  record: (durationMs: number) => void;
  read: () => LatencySnapshot;
}

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
      type: WORKER_EVENT.REQUEST;
      requestId: string;
      event: RequestMessage;
    }
  | {
      type: Exclude<WORKER_EVENT, WORKER_EVENT.REQUEST | WORKER_EVENT.REQUEST_BODY | WORKER_EVENT.METRICS | WORKER_EVENT.WS_MESSAGE_RECEIVE>;
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

/**
 * The middleware, and `close`, for a middleware that is not used any more: it stops the workers once they answered the requests they took, or all of them after `timeout` milliseconds
 * (0 by default), and resolves once they stopped.
 */
export type WorkerMiddleware = RequestHandler & { close: (timeout?: number) => Promise<void> };

/**
 * A route of the static table: a request whose path matches it goes to `worker`, without looking for a worker in the files under the root.
 * The worker is always the file named here, never a path made from the request.
 */
export type WorkerRoute =
  | {
      /** the path as it is, which is looked up in a map */
      path: string;
      /** the worker file, relative to the root or absolute, and may be outside of the root */
      worker: string;
    }
  | {
      /**
       * a regular expression that the whole path (without the query) has to match, it is anchored at both ends. Named groups are handed to the worker as `pathParameters`.
       * It runs on the front process for every request that gets to it, so it is trusted configuration: avoid patterns that backtrack, like nested repetitions.
       */
      pattern: string;
      /** of the regular expression: `i`, `s`, `u` or `v` */
      flags?: string;
      /** the worker file, relative to the root or absolute, and may be outside of the root */
      worker: string;
    };

export interface MiddlewareOptions {
  root: string;
  /** names the worker pool in the metrics, as `workers:<name>`. Defaults to the root folder. */
  name?: string;
  /** how many workers this server may run for all its paths together, 0 for no limit. When it is reached, an idle worker is stopped to make room for the first worker of a path. */
  limit?: number;
  /** workers started per path, requests are spread over them. Defaults to the available CPU cores, 0 or 1 keeps a single worker. */
  limitPerPath?: number | ((path: string) => number);
  /** a worker that has not had a request for this long is stopped, in milliseconds, the next request for its path starts one again. 0 keeps idle workers running. Defaults to 300000. */
  limitWorkerIdleTimeout?: number;
  /** a limit on the workers of this server together with the other servers that are given the same budget (`createWorkerBudget`), on top of `limit` */
  workerBudget?: WorkerBudget;
  /** start a worker for static files when the middleware is created, so the first request for a file does not wait for a process to start. Defaults to true. */
  warmStaticWorker?: boolean;
  /**
   * request paths (`/`, `/api/`) whose worker file is started when the middleware is created, and started again whenever it has fewer than `warmWorkersPerPath` workers,
   * so that no request has to wait for a process to start and load its module. The workers count towards `limit`, and requests that wait for a worker come first. Defaults to none.
   */
  warmPaths?: string[];
  /** how many workers are kept running for each of `warmPaths`, at most `limitPerPath`. Defaults to 1. */
  warmWorkersPerPath?: number;
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
  /** checked before the files under the root, in their order, the first one that matches is used. Validated when the middleware is created. */
  routes?: WorkerRoute[];
  /** a request that matches no route looks for a worker in the files under the root, as without routes. With `false` it is answered with 404. Defaults to true. */
  fallthrough?: boolean;
  env?: object;
  /**
   * the worker file for the paths that no worker answers. With the default one, a path that does not exist is answered with 404 by the middleware itself, without a worker:
   * another one is asked for those too, as it may answer them in its own way.
   */
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

/** an idle worker that a pool can stop to make room for another one */
export interface IdleWorker {
  /** the path has other workers, so stopping this one leaves the path with one */
  spare: boolean;
  /** when the worker finished its last request, or started when it had none, as `Date.now()` */
  lastUsed: number;
  stop: () => void;
}

/** a pool of workers as a budget sees it */
export interface WorkerBudgetMember {
  getWorkerCount: () => number;
  /** the idle worker the pool gives up first, undefined when all of its workers are busy */
  findIdleWorker: () => IdleWorker | undefined;
  /** the requests that wait for a worker in the pool look again whether they can get one */
  wakeUp: () => void;
}

/** A limit on the workers of several pools together, so that the processes of many servers and paths stay bounded. Made by `createWorkerBudget`. */
export interface WorkerBudget {
  /** how many workers the pools may run together, 0 for no limit */
  readonly limit: number;
  join: (member: WorkerBudgetMember) => void;
  /** a pool that is disposed of stops counting */
  leave: (member: WorkerBudgetMember) => void;
  hasRoom: () => boolean;
  /** the idle worker of all the pools that is given up first */
  findIdleWorker: () => IdleWorker | undefined;
  /** a worker stopped or became idle, the requests that wait in the other pools may get one now */
  wakeUp: (except?: WorkerBudgetMember) => void;
  getStats: () => { limit: number; workers: number };
}
export * from './cache';
