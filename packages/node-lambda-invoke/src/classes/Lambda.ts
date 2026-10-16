import type Worker from './Worker';
import { DEFAULT_TIMEOUT, EVENT_REQUEST, EVENT_RESPONSE } from '../constants';
import type RequestEvent from './RequestEvent';
import ResponseEvent from './ResponseEvent';
import type { LambdaEvent, Listener, Logger, StorageDriverConstructor } from '../types';

export interface LambdaOptions {
  StorageDriver: StorageDriverConstructor;
  /** where the lambda process keeps the files of the `file` communication, only for that communication */
  storageFolder?: string;
  logger?: Logger;
}

const failure = () => Object.assign(new ResponseEvent(), { statusCode: 500, body: 'Something went wrong.' });

/**
 * One lambda process. It answers one request at a time, which the pool makes sure of by reserving it before it is invoked.
 * It does no I/O of its own: the process and the storage driver are given.
 */
class Lambda {
  private isBusy = false;
  private isRetiring = false;
  private freeListener: () => void = () => {};

  constructor(
    private readonly worker: Worker,
    private readonly options: LambdaOptions
  ) {}

  /** taken by a request, from the moment it is handed out until the lambda answered it or was given back */
  get busy() {
    return this.isBusy;
  }

  /** not handed out any more, it is stopped as soon as it is idle */
  get retiring() {
    return this.isRetiring;
  }

  get storageFolder() {
    return this.options.storageFolder;
  }

  /** whether the process is still there */
  get running() {
    return this.worker.instance !== undefined;
  }

  get stdout() {
    return this.worker.stdout;
  }

  get stderr() {
    return this.worker.stderr;
  }

  /** marked right away: the invocation starts later, and requests in between must not get the same lambda */
  reserve() {
    this.isBusy = true;
  }

  retire() {
    this.isRetiring = true;
  }

  /** `listener` is called every time the lambda is free again, so that the pool can hand it to the next request in line */
  onFree(listener: () => void) {
    this.freeListener = listener;
  }

  /** gives the lambda back, answered or not used */
  markFree() {
    this.isBusy = false;
    this.freeListener();
  }

  invoke(requestId: string, requestEvent: RequestEvent, callback: (response: ResponseEvent) => void = () => {}, timeout = DEFAULT_TIMEOUT) {
    const { worker } = this;
    const { StorageDriver, storageFolder, logger = () => {} } = this.options;
    const storage = new StorageDriver(requestId, worker, storageFolder);
    // the state of the request is these closures, so the next request cannot replace it
    const onMessage = (event: LambdaEvent) => {
      if (event.type !== EVENT_RESPONSE || event.id !== requestId) return;

      worker.removeEventListener('message', onMessage);
      storage
        .getResponse()
        // a response that cannot be read answers the request with the failure, and not with an unhandled rejection, which ends the server
        .then(callback, (error) => {
          logger(error);
          callback(failure());
        })
        // the storage listens to the messages of the lambda until it is destroyed
        .finally(() => storage.destroy())
        .finally(() => this.markFree());
    };

    Promise.resolve()
      .then(() => storage.setRequest(requestEvent))
      .then(() => {
        this.reserve();
        worker.addEventListener('message', onMessage);
        worker.postMessage({ type: EVENT_REQUEST, id: requestId, deadline: Date.now() + timeout });
      })
      .catch((error) => {
        // the lambda was not given the request, so it is free again and the request is answered with the failure
        this.markFree();
        logger(error);
        callback(failure());
      });
  }

  terminate(signal?: NodeJS.Signals) {
    this.worker.terminate(signal);
  }

  addEventListener(event: string, listener: Listener) {
    this.worker.addEventListener(event, listener);
  }

  addEventListenerOnce(event: string, listener: Listener) {
    this.worker.addEventListenerOnce(event, listener);
  }

  removeEventListener(event: string, listener: Listener) {
    this.worker.removeEventListener(event, listener);
  }

  postMessage(message: Parameters<Worker['postMessage']>[0], cb: Parameters<Worker['postMessage']>[1] = () => {}) {
    this.worker.postMessage(message, cb);
  }
}

export default Lambda;
