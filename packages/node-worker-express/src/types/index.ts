import { WORKER_EVENT } from '../constants';
import { Request, Response } from 'express';
import type { Readable } from 'stream';

export type RequestEvent = {
  httpMethod: string;
  protocol: string;
  path: string;
  pathFragments: string[];
  queryStringParameters: { [key: string]: string };
  headers: { [key: string]: string };
  remoteAddress: string;
  body: string;
  rootPath: string;
  closed?: boolean;
  frame?: string;
  /** the body is not in `body`, it is read from the `bodyStream` the worker is called with */
  bodyStreamed?: boolean;
};

/** what a worker is called with: the request, and the stream to read the body from when it is streamed */
export type WorkerRequestEvent = RequestEvent & { bodyStream?: Readable };

/** a part of a streamed request body, `null` ends it */
export type RequestBodyEvent = { body: string | null; isBase64Encoded: boolean };

export type WorkerInputEvent =
  | {
      type: WORKER_EVENT.REQUEST_BODY;
      requestId: string;
      event: RequestBodyEvent;
    }
  | {
      type: Exclude<WORKER_EVENT, WORKER_EVENT.REQUEST_BODY>;
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

/**
 * The function a worker file exports. With `streamRequestBody` on, `event.bodyStream` is a Readable of the request body and `event.body` is empty.
 * Read the body before answering: once the response is complete the rest of the body is dropped and the stream is destroyed.
 */
export type InvokableWorker = (event: WorkerRequestEvent, callback: ResponseCallback) => unknown;

export interface MiddlewareOptions {
  root: string;
  limit?: number;
  /** workers started per path, requests are spread over them. Defaults to the available CPU cores, 0 or 1 keeps a single worker. */
  limitPerPath?: number | ((path: string) => number);
  /** start a worker for static files when the middleware is created, so the first request for a file does not wait for a process to start. Defaults to true. */
  warmStaticWorker?: boolean;
  /** the largest request body that is read into memory before the worker is called, in bytes */
  limitRequestBody?: number;
  /**
   * pass the body of requests to workers as a stream (`event.bodyStream`) instead of reading it into memory first, `true` for all workers or a function that decides per worker file.
   * The body is sent in parts the worker has to take before the next one is sent, so memory stays flat for uploads of any size. Defaults to false.
   */
  streamRequestBody?: boolean | ((workerPath: string) => boolean);
  /** the largest streamed request body in bytes, a bigger one is answered with 413. 0 for no limit, which is the default. */
  limitStreamedRequestBody?: number;
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
