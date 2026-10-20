import type { ResponseEvent } from '../types';

export enum WORKER_EVENT {
  /** the worker process loaded its file and takes requests, sent once. A pool that waits for it (`startTimeout`) hands the worker out only after that. */
  READY = 'WORKER_READY',
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
  /**
   * the worker asks to write a streamed body to the client itself, with the head of the response. The server answers with the connection of the client,
   * sent along with this message over the IPC channel, or with a refusal, after which the body is streamed as usual
   */
  RESPONSE_HANDOFF = 'WORKER_RESPONSE_HANDOFF',
  RESPONSE_HANDOFF_REFUSE = 'WORKER_RESPONSE_HANDOFF_REFUSE',
  /**
   * the server hands the connection of a client with a big request body to the worker, over the IPC channel, with the request and what had arrived of the body. The worker reads the rest of
   * the body and writes the response to the connection itself, and tells the server with `REQUEST_HANDOFF_DONE` when the connection is closed.
   */
  REQUEST_HANDOFF = 'WORKER_REQUEST_HANDOFF',
  REQUEST_HANDOFF_DONE = 'WORKER_REQUEST_HANDOFF_DONE',
  WS_MESSAGE_RECEIVE = 'WS_MESSAGE_RECEIVE',
  /** the worker is done with a received message, the server may pass on another one */
  WS_MESSAGE_ACKNOWLEDGE = 'WS_MESSAGE_ACK',
  WS_MESSAGE_SEND = 'WS_MESSAGE_SEND',
  WS_CONNECTION_CLOSE = 'WS_CONNECTION_CLOSE',
  WS_CONNECTION_CLOSE_ACKNOWLEDGE = 'WS_CONNECTION_CLOSE_ACK',
}

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

export enum Protocols {
  http = 'HTTP',
  websocket = 'WS',
}

/** what a request is answered with when its worker fails before it answered */
export const InternalServerError: ResponseEvent = {
  statusCode: 500,
  headers: { 'Content-Type': 'text/plain' },
  body: 'Internal Server Error',
  isBase64Encoded: false,
};
