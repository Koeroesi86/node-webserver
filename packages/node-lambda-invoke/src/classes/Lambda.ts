import { rmSync } from 'fs';
import { rm } from 'fs/promises';
import { resolve } from 'path';
import Worker from './Worker';
import { DEFAULT_TIMEOUT, EVENT_REQUEST, EVENT_RESPONSE, LIFESPAN } from '../constants';
import createLambdaEnvironment from '../utils/create-lambda-environment';
import createLambdaFolder from '../utils/create-lambda-folder';
import createPermissionFlags from '../utils/create-permission-flags';
import { getRegisteredPath } from '../registry';
import type RequestEvent from './RequestEvent';
import ResponseEvent from './ResponseEvent';
import type { Communication, LambdaEvent, Listener, Logger, Storage, StorageDriverConstructor } from '../types';

/** the folders of the lambda processes that run, removed when the server exits, which stops them as well. Only a kill leaves them, the next server sweeps them. */
const lambdaFolders = new Set<string>();

process.once('exit', () => lambdaFolders.forEach((folder) => rmSync(folder, { recursive: true, force: true })));

class Lambda {
  private readonly _path: string;
  private readonly _handler: string;
  private readonly _logger: Logger;
  private readonly _storagePath: string;
  private readonly _communication: Communication;
  private readonly _env?: Record<string, string>;
  private readonly _maxLifetime: number;
  private readonly _restrictFileSystem: boolean;
  private _storage?: Storage;
  private _requestId?: string;
  private _callback: (response: ResponseEvent) => void = () => {};
  readonly StorageDriver: StorageDriverConstructor;
  instance: Worker | null;
  busy: boolean;
  createdAt?: number;
  /** not handed out any more, it is stopped as soon as it is idle */
  retiring = false;
  /** where the lambda process keeps the files of the `file` communication, only for that communication */
  storageFolder?: string;
  /** called when the lambda is free again, so that the pool can hand it to the next request in line */
  onFree: () => void = () => {};

  constructor(
    path: string,
    handler: string,
    logger: Logger = () => {},
    communication: Communication,
    env?: Record<string, string>,
    { maxLifetime = LIFESPAN, restrictFileSystem = true }: { maxLifetime?: number; restrictFileSystem?: boolean } = {}
  ) {
    this._path = path;
    this._handler = handler;
    this._logger = logger;
    this._storagePath = getRegisteredPath(communication.type);
    this._communication = communication;
    this._env = env;
    this._maxLifetime = maxLifetime;
    this._restrictFileSystem = restrictFileSystem;
    this.StorageDriver = require(this._storagePath);
    const instance = this.createInstance();
    this.instance = instance;
    this.busy = false;

    instance.addEventListenerOnce('close', () => {
      this.instance = null;
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
    const folder = createLambdaFolder(this._communication.type === 'file');
    lambdaFolders.add(folder.root);
    this.storageFolder = folder.storage;
    const writableFolders = [folder.tmp, ...(folder.storage ? [folder.storage] : [])];
    const instance = new Worker(resolve(__dirname, '../middlewares/invoke.js'), {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: createLambdaEnvironment(this._path, this._handler, this._communication, this._env, {
        tmpFolder: folder.tmp,
        storageFolder: folder.storage,
        maxLifetime: this._maxLifetime,
      }),
      execArgv: this._restrictFileSystem ? createPermissionFlags(writableFolders) : [],
    });
    // what the lambda wrote is gone with it, as the storage of an environment of AWS is
    instance.addEventListenerOnce('close', () => {
      lambdaFolders.delete(folder.root);
      rm(folder.root, { recursive: true, force: true }).catch((error) => this._logger(error));
    });

    return instance;
  }

  invoke(requestId: string, requestEvent: RequestEvent, callback: (response: ResponseEvent) => void = () => {}, timeout = DEFAULT_TIMEOUT) {
    if (!this.instance) this.instance = this.createInstance();
    const { instance } = this;
    const storage = new this.StorageDriver(requestId, instance, this.storageFolder);
    this._storage = storage;
    Promise.resolve()
      .then(() => storage.setRequest(requestEvent))
      .then(() => {
        this.busy = true;
        this._requestId = requestId;
        this._callback = callback;
        instance.addEventListener('message', this._onFinished);
        instance.postMessage({ type: EVENT_REQUEST, id: requestId, deadline: Date.now() + timeout });
      })
      .catch((error) => {
        // the lambda was not given the request, so it is free again and the request is answered with the failure
        this.busy = false;
        this.onFree();
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
        // a response that cannot be read answers the request with the failure, and not with an unhandled rejection, which ends the server
        .then(
          (responseEvent) => callback(responseEvent),
          (error) => {
            this._logger(error);
            callback(Object.assign(new ResponseEvent(), { statusCode: 500, body: 'Something went wrong.' }));
          }
        )
        // the storage listens to the messages of the lambda until it is destroyed
        .finally(() => storage.destroy())
        .finally(() => {
          this.busy = false;
          this.onFree();
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
