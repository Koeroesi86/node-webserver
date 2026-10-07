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
  frame?: string;
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

/** a part of a streamed request body, `null` ends it */
export type RequestBodyEvent = { body: string | null; isBase64Encoded: boolean };

export type WorkerInputEvent =
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
      type: Exclude<WORKER_EVENT, WORKER_EVENT.REQUEST_BODY | WORKER_EVENT.METRICS>;
      requestId: string;
      event?: RequestEvent;
    };

export type WorkerOutputEvent =
  | {
      type: Exclude<WORKER_EVENT, WORKER_EVENT.WS_MESSAGE_SEND>;
      requestId: string;
      event?: ResponseEvent;
    }
  | {
      type: WORKER_EVENT.WS_MESSAGE_SEND;
      requestId: string;
      event?: WSFrameEvent;
    };

export type ResponseEvent = {
  statusCode: number;
  headers?: { [key: string]: string };
  isBase64Encoded?: boolean;
  emit?: boolean;
  body?: string;
};

export type WSFrameEvent = {
  sendWsMessage: boolean;
  frame: string;
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
  /** how long a request may wait for a worker when none can be started, in milliseconds */
  limitRequestTimeout?: number;
  /** how long the worker may stay silent while answering an HTTP request before it is answered with 504, 0 disables it */
  limitResponseTimeout?: number;
  idleCheckTimeout?: number;
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
  onExit?: (code: number, workerPath: string, id: string) => void;
  onForbiddenPath?: (request: Request, response: Response) => unknown;
  index?: string[];
  env?: object;
  staticWorker?: string;
  cwd?: string;
}
