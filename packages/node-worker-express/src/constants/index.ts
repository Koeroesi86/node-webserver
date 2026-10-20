import os from 'os';
import path from 'path';
import type { MiddlewareOptions } from '../types';

/** the static worker sends files up to this size in one part, bigger ones are streamed so they do not have to fit into the memory */
export const StaticStreamThreshold = 1024 * 1024;

/**
 * Every static worker keeps the files it sends in one part in memory, up to this many of them and this many bytes, the least recently used go first.
 * A file is read again when its size or modification time changed, which the worker checks for every request anyway.
 */
export const StaticFileCache = { entries: 1000, bytes: 16 * 1024 * 1024 };

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

/** the upper bounds of the buckets the latency of requests is counted in, in milliseconds. One more bucket takes what is slower than the last. */
export const LatencyBucketsMs: readonly number[] = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];

/** how many worker files of a worker server get a latency histogram of their own, the ones after share one, so the metrics cannot grow without a limit */
export const LatencyPathLimit = 100;

/** the name of the histogram the worker files above `LatencyPathLimit` share */
export const LatencyOtherPaths = '(other)';

/** a longer path matches no route, which bounds the work of a pattern on what a client sends */
export const RoutePathLimit = 2048;

/** the flags a route may give its pattern, the ones that keep a state between matches (`g`, `y`) would make a match depend on the requests before */
export const RoutePatternFlags: readonly string[] = ['i', 's', 'u', 'v'];

/** the environment variable the static worker is given its options in, as JSON */
export const StaticOptionsEnv = 'NODE_WORKER_STATIC_OPTIONS';

export const ForbiddenPaths: readonly string[] = ['..'] as const;

export const DefaultOptions: MiddlewareOptions = {
  root: '',
  limit: 0,
  limitPerPath: os.availableParallelism(),
  limitWorkerIdleTimeout: 5 * 60 * 1000,
  warmStaticWorker: true,
  warmPaths: [],
  warmWorkersPerPath: 1,
  limitRequestBody: 0,
  inlineRequestBody: 64 * 1024,
  limitRequestTimeout: 5000,
  limitResponseTimeout: 30000,
  handOffResponses: 8 * 1024 * 1024,
  handOffRequests: 0,
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
  routes: [],
  fallthrough: true,
  env: {},
  staticWorker: path.resolve(__dirname, '../staticWorker.js'),
  cwd: process.cwd(),
};
