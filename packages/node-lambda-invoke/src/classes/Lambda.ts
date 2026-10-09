import { resolve } from 'path';
import Worker from './Worker';
import { EVENT_REQUEST, EVENT_RESPONSE } from '../constants';
import createLambdaEnvironment from '../utils/create-lambda-environment';
import { getRegisteredPath } from '../registry';
import type RequestEvent from './RequestEvent';
import ResponseEvent from './ResponseEvent';
import type { Communication, LambdaEvent, Listener, Logger, Storage, StorageDriverConstructor } from '../types';

class Lambda {
  private readonly _path: string;
  private readonly _handler: string;
  private readonly _logger: Logger;
  private readonly _storagePath: string;
  private readonly _communication: Communication;
  private readonly _env?: Record<string, string>;
  private _storage?: Storage;
  private _requestId?: string;
  private _callback: (response: ResponseEvent) => void = () => {};
  readonly StorageDriver: StorageDriverConstructor;
  instance: Worker | null;
  busy: boolean;
  createdAt?: number;

  constructor(path: string, handler: string, logger: Logger = () => {}, communication: Communication, env?: Record<string, string>) {
    this._path = path;
    this._handler = handler;
    this._logger = logger;
    this._storagePath = getRegisteredPath(communication.type);
    this._communication = communication;
    this._env = env;
    this.StorageDriver = require(this._storagePath);
    const instance = this.createInstance();
    this.instance = instance;
    this.busy = false;

    const killTimer = setTimeout(() => {
      this._logger('Shutting down lambda.');
      if (this.instance) {
        this.instance.terminate();
        this.instance = null;
      }
    }, 15 * 60 * 1000);

    instance.addEventListenerOnce('close', () => {
      this.instance = null;
      clearTimeout(killTimer);
    });

    this._onFinished = this._onFinished.bind(this);
  }

  get stdout() {
    return this.instance?.stdout;
  }

  get stderr() {
    return this.instance?.stderr;
  }

  createInstance(): Worker {
    return new Worker(resolve(__dirname, '../middlewares/invoke.js'), {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: createLambdaEnvironment(this._path, this._handler, this._communication, this._env),
    });
  }

  invoke(requestId: string, requestEvent: RequestEvent, callback: (response: ResponseEvent) => void = () => {}) {
    if (!this.instance) this.instance = this.createInstance();
    const { instance } = this;
    const storage = new this.StorageDriver(requestId, instance);
    this._storage = storage;
    Promise.resolve()
      .then(() => storage.setRequest(requestEvent))
      .then(() => {
        this.busy = true;
        this._requestId = requestId;
        this._callback = callback;
        instance.addEventListener('message', this._onFinished);
        instance.postMessage({ type: EVENT_REQUEST, id: requestId });
      })
      .catch((error) => {
        // the lambda was not given the request, so it is free again and the request is answered with the failure
        this.busy = false;
        this._logger(error);
        callback(Object.assign(new ResponseEvent(), { statusCode: 500, body: 'Something went wrong.' }));
      });
  }

  /** @private */
  _onFinished(event: LambdaEvent) {
    if (event.type === EVENT_RESPONSE && event.id === this._requestId) {
      // the next request replaces these as soon as the lambda is free
      const { _storage: storage, _callback: callback } = this;
      this.instance?.removeEventListener('message', this._onFinished);
      storage
        ?.getResponse()
        .then((responseEvent) => callback(responseEvent))
        // the storage listens to the messages of the lambda until it is destroyed
        .finally(() => storage.destroy())
        .finally(() => {
          this.busy = false;
        });
    }
  }

  terminate(signal?: NodeJS.Signals) {
    this.instance?.terminate(signal);
  }

  addEventListener(event: string, listener: Listener) {
    this.instance?.addEventListener(event, listener);
  }

  addEventListenerOnce(event: string, listener: Listener) {
    this.instance?.addEventListenerOnce(event, listener);
  }

  removeEventListener(event: string, listener: Listener) {
    this.instance?.removeEventListener(event, listener);
  }

  postMessage(message: Parameters<Worker['postMessage']>[0], cb: Parameters<Worker['postMessage']>[1] = () => {}) {
    this.instance?.postMessage(message, cb);
  }
}

export default Lambda;
