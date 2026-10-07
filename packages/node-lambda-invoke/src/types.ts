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
  /** how many lambdas may run in total, they are shared by all requests: a lambda answers one request at a time. Defaults to the number of CPU cores, 0 means no limit. */
  limit?: number;
  /** how long a request waits for a lambda when the limit is reached before it is answered with 503, in milliseconds. Defaults to 10000. */
  acquireTimeout?: number;
  communication?: Communication;
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
