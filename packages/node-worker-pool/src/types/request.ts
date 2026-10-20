import type { Readable } from 'stream';
import type { ServerMetrics } from './metrics';

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
  /**
   * the headers as the client wrote them (names and values in turn, a header that came more than once is there for each), where `headers` has the repeated ones joined.
   * Only set by a server that needs them, as the one of the lambdas.
   */
  rawHeaders?: string[];
  /** the HTTP version of the request, `1.1` for example. Only set where it is needed, as for the lambdas. */
  httpVersion?: string;
  /** when the request has to be answered, in milliseconds since the epoch. Only set by a server that has a time limit of its own, as the one of the lambdas. */
  deadline?: number;
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
  /** the id of the request, the same the server and the worker call it by */
  requestId: string;
  /** the body of the request, empty for requests that have none. It ends with an error when the client goes away. */
  bodyStream: Readable;
  /** a snapshot of the server: uptime, memory, event loop delay, requests, worker pools and what else registered itself */
  getMetrics: () => Promise<ServerMetrics>;
};

/** a part of a streamed request body as it travels to the worker, `null` ends it */
export type RequestBodyEvent = { body: Buffer | null };
