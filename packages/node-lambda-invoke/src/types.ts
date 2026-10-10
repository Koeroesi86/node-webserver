import type Lambda from './classes/Lambda';
import type RequestEvent from './classes/RequestEvent';
import type ResponseEvent from './classes/ResponseEvent';
import type Worker from './classes/Worker';

/** a listener of any event of an EventEmitter */
export type Listener = Parameters<NodeJS.EventEmitter['on']>[1];

export type Logger = (...args: unknown[]) => void;

export interface Communication {
  type?: string;
  path?: string;
}

export interface HttpMiddlewareOptions {
  lambdaPath: string;
  handlerKey?: string;
  logger?: Logger;
  /**
   * how many lambdas this middleware may run, they are shared by all of its requests: a lambda answers one request at a time. Defaults to the number of CPU cores, 0 means no limit.
   * Every middleware has a limit of its own.
   */
  limit?: number;
  /** how long a request waits for a lambda when the limit is reached before it is answered with 503, in milliseconds. Defaults to 10000. */
  acquireTimeout?: number;
  /** how long a lambda may take to load and start, in milliseconds, before it is stopped and the request is answered with 500. Defaults to 10000. */
  startTimeout?: number;
  /** how long the handler may take to answer, in milliseconds, before the lambda is stopped and the request is answered with 504. Defaults to 900000 (15 minutes). */
  timeout?: number;
  /** the largest body of a request in bytes, larger ones are answered with 413, 0 for no limit. Defaults to 6291456 (6 MiB), the payload limit of AWS. */
  limitRequestBody?: number;
  /** variables added to the environment of the lambdas, which only get a few of the server (`PATH`, `HOME`, `TZ`, ...) */
  env?: Record<string, string>;
  communication?: Communication;
}

/** what API Gateway tells a lambda about the request */
export interface RequestContext {
  accountId: string;
  apiId: string;
  stage: string;
  /** the id of the invocation, which is also the `awsRequestId` of the context */
  requestId: string;
  resourcePath: string;
  httpMethod: string;
  path: string;
  protocol: string;
  requestTime: string;
  requestTimeEpoch: number;
  domainName: string;
  identity: { sourceIp: string; userAgent: string };
}

/** an event emitted by a lambda worker */
export interface LambdaEvent {
  type?: string;
  id?: string;
}

/** what a storage can be attached to: the worker itself, a lambda or the current process */
export type StorageInstance = Lambda | Worker | NodeJS.Process;

export interface Storage {
  setResponse: (response: ResponseEvent) => Promise<unknown>;
  getResponse: () => Promise<ResponseEvent>;
  setRequest: (request: RequestEvent) => Promise<unknown>;
  getRequest: () => Promise<RequestEvent>;
  destroy: () => Promise<unknown>;
}

export interface StorageDriverConstructor {
  new (id: string, instance: StorageInstance): Storage;
  start?: () => void;
}
