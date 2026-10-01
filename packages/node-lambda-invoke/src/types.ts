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
  limit?: number;
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
