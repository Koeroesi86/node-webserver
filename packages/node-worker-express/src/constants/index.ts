import os from 'os';
import path from 'path';
import { MiddlewareOptions } from '../types';

export enum WORKER_EVENT {
  REQUEST = 'WORKER_REQUEST',
  /** not sent any more, nothing listened to it */
  REQUEST_ACKNOWLEDGE = 'WORKER_REQUEST_ACK',
  /** the client went away before the response was complete, a worker streaming it should stop */
  REQUEST_ABORT = 'WORKER_REQUEST_ABORT',
  /** a part of a request body that is streamed to the worker, the last one has no body */
  REQUEST_BODY = 'WORKER_REQUEST_BODY',
  /** the worker took a part of the streamed request body, the server may send another one */
  REQUEST_BODY_ACKNOWLEDGE = 'WORKER_REQUEST_BODY_ACK',
  /** a worker asks for the metrics of the server */
  METRICS_REQUEST = 'WORKER_METRICS_REQUEST',
  METRICS = 'WORKER_METRICS',
  RESPONSE = 'WORKER_RESPONSE',
  RESPONSE_EMIT = 'WORKER_RESPONSE_EMIT',
  RESPONSE_ACKNOWLEDGE = 'WORKER_RESPONSE_ACK',
  WS_MESSAGE_RECEIVE = 'WS_MESSAGE_RECEIVE',
  WS_MESSAGE_SEND = 'WS_MESSAGE_SEND',
  WS_CONNECTION_CLOSE = 'WS_CONNECTION_CLOSE',
  WS_CONNECTION_CLOSE_ACKNOWLEDGE = 'WS_CONNECTION_CLOSE_ACK',
}

/** the static worker sends files up to this size in one part, bigger ones are streamed so they do not have to fit into the memory */
export const StaticStreamThreshold = 1024 * 1024;

/** how many parts of a streamed request body may be on their way to the worker before it takes one */
export const RequestBodyWindow = 4;

/** a worker that stops sooner than this after it started, or with an error, has crashed, in milliseconds */
export const WorkerMinUptime = 5000;

/**
 * Starting a worker for a path that crashed twice in a row is refused for this long, doubling with every crash until the maximum,
 * so that a worker that fails at start does not cost a process for every request. In milliseconds.
 */
export const WorkerRestartBackoff = { base: 100, max: 10000 };

export const ForbiddenPaths: readonly string[] = ['..'] as const;

export enum Protocols {
  http = 'HTTP',
  websocket = 'WS',
}

export const DefaultOptions: MiddlewareOptions = {
  root: '',
  limit: 0,
  limitPerPath: os.availableParallelism(),
  warmStaticWorker: true,
  limitRequestBody: 0,
  limitRequestTimeout: 5000,
  limitResponseTimeout: 30000,
  idleCheckTimeout: 5,
  onStdout: () => {},
  onStderr: () => {},
  onExit: () => {},
  onForbiddenPath: (request, response) => {
    response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end();
    request.connection.destroy();
    throw new Error('Forbidden path');
  },
  index: [],
  env: {},
  staticWorker: path.resolve(__dirname, './staticWorker.js'),
  cwd: process.cwd(),
};
