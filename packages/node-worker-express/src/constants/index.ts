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
  /** the worker is done with a received message, the server may pass on another one */
  WS_MESSAGE_ACKNOWLEDGE = 'WS_MESSAGE_ACK',
  WS_MESSAGE_SEND = 'WS_MESSAGE_SEND',
  WS_CONNECTION_CLOSE = 'WS_CONNECTION_CLOSE',
  WS_CONNECTION_CLOSE_ACKNOWLEDGE = 'WS_CONNECTION_CLOSE_ACK',
}

/** the static worker sends files up to this size in one part, bigger ones are streamed so they do not have to fit into the memory */
export const StaticStreamThreshold = 1024 * 1024;

/**
 * The largest frame of the channel between the server and a worker, in bytes, which a message and its body have to fit in.
 * A length above it is taken for garbage and closes the channel, instead of buffering up to the 4 GiB a length can say.
 * Bodies up to about 400 MB were all the JSON of the IPC before the socket pair could carry as base64, so no response that worked then is refused.
 */
export const ChannelMaxFrameLength = 512 * 1024 * 1024;

/** how many parts of a streamed request body may be on their way to the worker before it takes one */
export const RequestBodyWindow = 4;

/** a worker that stops sooner than this after it started, or with an error, has crashed, in milliseconds */
export const WorkerMinUptime = 5000;

/**
 * Starting a worker for a path that crashed twice in a row is refused for this long, doubling with every crash until the maximum,
 * so that a worker that fails at start does not cost a process for every request. In milliseconds.
 */
export const WorkerRestartBackoff = { base: 100, max: 10000 };

/** how many websocket messages, and how many bytes of them, may be on their way to the worker before it has taken one, the socket of the client is paused above that */
export const WebSocketWindow = { messages: 16, bytes: 1024 * 1024 };

/** a client that does not take what is written to it, so that more than this many bytes wait in the server, is closed instead of buffered without a limit */
export const WebSocketSendBuffer = 8 * 1024 * 1024;

/** how long a connection that was told to close gets to close itself, before the server destroys the socket, in milliseconds */
export const WebSocketCloseTimeout = 5000;

export const WebSocketOpcode = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
} as const;

export const WebSocketCloseCode = {
  normal: 1000,
  goingAway: 1001,
  protocolError: 1002,
  invalidData: 1007,
  policy: 1008,
  tooBig: 1009,
} as const;

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
  inlineRequestBody: 64 * 1024,
  limitRequestTimeout: 5000,
  limitResponseTimeout: 30000,
  limitQueue: 1000,
  limitWebSocketMessage: 1024 * 1024,
  limitWebSocketConnections: 1000,
  webSocketPingInterval: 30000,
  limitWebSocketIdleTimeout: 90000,
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
  staticWorker: path.resolve(__dirname, '../staticWorker.js'),
  cwd: process.cwd(),
};
