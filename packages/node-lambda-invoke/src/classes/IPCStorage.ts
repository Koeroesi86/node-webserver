import Lambda from './Lambda';
import Worker from './Worker';
import sendToParent from '../utils/sendToParent';
import type RequestEvent from './RequestEvent';
import type ResponseEvent from './ResponseEvent';
import type { StorageInstance } from '../types';

const MESSAGES = {
  GET_RESONSE: 'GW_GET_RESONSE',
  SET_RESONSE: 'GW_SET_RESONSE',
  SET_RESONSE_FINISHED: 'GW_SET_RESONSE_FINISHED',
  GET_REQUEST: 'GW_GET_REQUEST',
  SET_REQUEST: 'GW_SET_REQUEST',
  SET_REQUEST_FINISHED: 'GW_SET_REQUEST_FINISHED',
  DESTROY: 'GW_DESTROY',
} as const;

type IpcMessage =
  | { type: typeof MESSAGES.SET_REQUEST; id: string; payload: RequestEvent }
  | { type: typeof MESSAGES.SET_RESONSE; id: string; payload: ResponseEvent }
  | {
      type:
        | typeof MESSAGES.GET_RESONSE
        | typeof MESSAGES.GET_REQUEST
        | typeof MESSAGES.SET_RESONSE_FINISHED
        | typeof MESSAGES.SET_REQUEST_FINISHED
        | typeof MESSAGES.DESTROY;
      id: string;
    };

/** the side of the communication that exchanges messages through `on`, `off` and `send` */
interface MessageEndpoint {
  on: (listener: (message: unknown) => void) => void;
  off: (listener: (message: unknown) => void) => void;
  send: (message: IpcMessage) => void;
}

let requests: Record<string, RequestEvent> = {};
let responses: Record<string, ResponseEvent> = {};

const getRequestKey = (id: string) => `request-${id}`;
const getResponseKey = (id: string) => `response-${id}`;

const isIpcMessage = (message: unknown): message is IpcMessage => typeof message === 'object' && message !== null && 'type' in message && 'id' in message;

const toEndpoint = (instance: Worker | NodeJS.Process): MessageEndpoint => {
  if (instance instanceof Worker) {
    return {
      on: (listener) => instance.on('message', listener),
      off: (listener) => instance.off('message', listener),
      send: (message) => instance.send(message),
    };
  }

  return {
    on: (listener) => instance.on('message', listener),
    off: (listener) => instance.off('message', listener),
    send: (message) => {
      if (!instance.send) throw new Error('There is no IPC channel to the parent process.');
      instance.send(message);
    },
  };
};

process.on('message', (message) => {
  if (!isIpcMessage(message)) return;

  if (message.type === MESSAGES.SET_REQUEST) {
    requests[getRequestKey(message.id)] = message.payload;
    sendToParent({ type: MESSAGES.SET_REQUEST_FINISHED, id: message.id });
  }

  if (message.type === MESSAGES.SET_RESONSE) {
    responses[getResponseKey(message.id)] = message.payload;
    sendToParent({ type: MESSAGES.SET_RESONSE_FINISHED, id: message.id });
  }

  // if (message.type === MESSAGES.DESTROY) {
  //   const requestId = getResponseKey(message.id);
  //   delete storage[requestId];
  //   const responseId = getResponseKey(message.id);
  //   delete storage[responseId];
  // }
});

/** loaded by file path, so it has to stay a CommonJS `module.exports` */
class IPCStorage {
  static start() {
    requests = {};
    responses = {};
  }

  constructor(readonly id: string, readonly instance: StorageInstance) {
    this.setResponse = this.setResponse.bind(this);
    this.getResponse = this.getResponse.bind(this);
    this.setRequest = this.setRequest.bind(this);
    this.getRequest = this.getRequest.bind(this);
    this.destroy = this.destroy.bind(this);
    this.invoker = this.invoker.bind(this);
    this.executor = this.executor.bind(this);
    this.invokerMessageListener = this.invokerMessageListener.bind(this);
    this.executorMessageListener = this.executorMessageListener.bind(this);

    if (this.instance instanceof Lambda) {
      this.invoker(this.instance);
    } else {
      this.executor(this.instance);
    }
  }

  /** the message endpoint of a worker or process, a lambda is not able to exchange messages this way */
  private get endpoint(): MessageEndpoint {
    if (this.instance instanceof Lambda) {
      throw new Error('A storage attached to a lambda can only be destroyed.');
    }

    return toEndpoint(this.instance);
  }

  invoker(lambda: Lambda) {
    lambda.addEventListener('message', this.invokerMessageListener);
  }

  invokerMessageListener(message: unknown) {
    if (!isIpcMessage(message) || !(this.instance instanceof Lambda)) return;

    if (message.type === MESSAGES.GET_REQUEST) {
      const item = requests[getRequestKey(message.id)];
      if (item) {
        this.instance.postMessage({ type: MESSAGES.SET_REQUEST, id: message.id, payload: item });
      }
    }

    if (message.type === MESSAGES.SET_RESONSE) {
      responses[getResponseKey(message.id)] = message.payload;
      this.instance.postMessage({ type: MESSAGES.SET_RESONSE_FINISHED, id: message.id });
    }
  }

  executor(instance: Worker | NodeJS.Process) {
    toEndpoint(instance).on(this.executorMessageListener);
  }

  executorMessageListener(message: unknown) {
    if (!isIpcMessage(message)) return;

    if (message.type === MESSAGES.SET_REQUEST) {
      requests[getRequestKey(message.id)] = message.payload;
      sendToParent({ type: MESSAGES.SET_REQUEST_FINISHED, id: message.id });
    }

    if (message.type === MESSAGES.GET_RESONSE) {
      const item = responses[getResponseKey(message.id)];
      if (item) {
        sendToParent({ type: MESSAGES.SET_RESONSE, id: message.id, payload: item });
      }
    }
  }

  get requestKey(): string {
    return getRequestKey(this.id);
  }

  get responseKey(): string {
    return getResponseKey(this.id);
  }

  setResponse(response: ResponseEvent): Promise<void> {
    responses[this.responseKey] = response;
    return new Promise((resolve) => {
      const { endpoint } = this;
      const finishListener = (message: unknown) => {
        if (isIpcMessage(message) && message.type === MESSAGES.SET_RESONSE_FINISHED && message.id === this.id) {
          resolve();
          endpoint.off(finishListener);
        }
      };
      endpoint.on(finishListener);
      endpoint.send({ type: MESSAGES.SET_RESONSE, id: this.id, payload: response });
    });
  }

  getResponse(): Promise<ResponseEvent> {
    return new Promise((resolve) => {
      const stored = responses[this.responseKey];
      if (stored) return resolve(stored);
      const { endpoint } = this;
      const finishListener = (message: unknown) => {
        if (isIpcMessage(message) && message.type === MESSAGES.SET_RESONSE && message.id === this.id) {
          responses[this.responseKey] = message.payload;
          resolve(message.payload);
          endpoint.off(finishListener);
        }
      };
      endpoint.on(finishListener);
      endpoint.send({ type: MESSAGES.GET_RESONSE, id: this.id });
    });
  }

  setRequest(request: RequestEvent): Promise<void> {
    requests[this.requestKey] = request;
    return new Promise((resolve) => {
      const { endpoint } = this;
      const finishListener = (message: unknown) => {
        if (isIpcMessage(message) && message.type === MESSAGES.SET_REQUEST_FINISHED && message.id === this.id) {
          resolve();
          endpoint.off(finishListener);
        }
      };
      endpoint.on(finishListener);
      endpoint.send({ type: MESSAGES.SET_REQUEST, id: this.id, payload: request });
    });
  }

  getRequest(): Promise<RequestEvent> {
    return new Promise((resolve) => {
      const stored = requests[this.requestKey];
      if (stored) return resolve(stored);
      const { endpoint } = this;
      const finishListener = (message: unknown) => {
        if (isIpcMessage(message) && message.type === MESSAGES.SET_REQUEST && message.id === this.id) {
          requests[this.requestKey] = message.payload;
          resolve(message.payload);
          endpoint.off(finishListener);
          // this.instance.send({ type: MESSAGES.SET_REQUEST_FINISHED, id: message.id })
        }
      };
      endpoint.on(finishListener);
      endpoint.send({ type: MESSAGES.GET_REQUEST, id: this.id });
    });
  }

  destroy(): Promise<void> {
    delete requests[this.requestKey];
    delete responses[this.responseKey];

    if (this.instance instanceof Lambda) {
      this.instance.removeEventListener('message', this.invokerMessageListener);
    } else {
      toEndpoint(this.instance).off(this.executorMessageListener);
    }

    return Promise.resolve();
  }
}

export = IPCStorage;
