import type { Request, RequestHandler, Response } from 'express';
import type { StaticOptions, WorkerRoute } from './routes';
import type { WorkerBudget } from '@koeroesi86/node-worker/pool';

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
  /**
   * a streamed response of at least this many bytes (by its `Content-Length`) on a plain HTTP/1 connection is written to the client by the worker itself: the server hands the socket over,
   * so the body does not pass through it, and the connection is closed after the body. 0 disables it. Defaults to 8 MiB.
   * Disable it when a middleware in front of this one changes the body other than by setting `Content-Encoding` (as compression does), the body would bypass it.
   */
  handOffResponses?: number;
  /**
   * a request with a body of at least this many bytes (by its `Content-Length`) on a plain HTTP/1 connection is read by the worker itself: the server hands the socket over after the head of the request,
   * so the body does not pass through it, and the worker writes the response to the client, after which the connection is closed. Not for chunked bodies, websockets, HTTPS or HTTP/2, those stream through the server.
   * The worker keeps the limits that can be kept: `limitRequestBody` is checked against the `Content-Length` before the hand over, and the client may take nothing for `limitResponseTimeout` at most.
   * A middleware in front does not see the response, so there is no compression of it. 0 disables it, which is the default.
   */
  handOffRequests?: number;
  /**
   * how many directories the middleware lists and watches at the same time to answer a path that is not there without asking the file system, no other is listed until a listing has expired.
   * 0 switches it off, which is for file systems that do not report changes (network drives, some container mounts). Defaults to 256.
   */
  limitWatchedDirectories?: number;
  /** how many names all the listings together hold, which bounds their memory, a directory with more entries than 5000 is not listed. Defaults to 20000. */
  limitWatchedEntries?: number;
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
  /** the options of the default static worker: cache headers per path, directory listings and precompressed files. Range requests are always answered. */
  static?: StaticOptions;
  cwd?: string;
}

/**
 * The middleware, and `close`, for a middleware that is not used any more: it stops the workers once they answered the requests they took, or all of them after `timeout` milliseconds
 * (0 by default), and resolves once they stopped.
 */
export type WorkerMiddleware = RequestHandler & { close: (timeout?: number) => Promise<void> };
