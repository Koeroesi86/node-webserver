import { MESSAGES, isIpcMessage } from '../utils/ipc-messages';
import { ipcStore } from '../utils/ipc-store';
import type Lambda from './Lambda';
import type RequestEvent from './RequestEvent';
import type ResponseEvent from './ResponseEvent';
import type { Storage } from '../types';

const NOT_AN_ENDPOINT = 'A storage attached to a lambda can only be destroyed.';

/** the storage in the server process that serves a lambda: it hands the request over when asked and keeps the response the lambda sends */
export class IPCInvokerStorage implements Storage {
  constructor(
    readonly id: string,
    private readonly lambda: Lambda
  ) {
    lambda.addEventListener('message', this.onMessage);
  }

  private onMessage = (message: unknown) => {
    if (!isIpcMessage(message)) return;

    const request = message.type === MESSAGES.GET_REQUEST ? ipcStore.findRequest(message.id) : undefined;
    if (request) this.lambda.postMessage({ type: MESSAGES.SET_REQUEST, id: message.id, payload: request });

    if (message.type !== MESSAGES.SET_RESPONSE) return;

    ipcStore.keepResponse(message.id, message.payload);
    this.lambda.postMessage({ type: MESSAGES.SET_RESPONSE_FINISHED, id: message.id });
  };

  setResponse(response: ResponseEvent): Promise<void> {
    ipcStore.keepResponse(this.id, response);
    return Promise.reject(new Error(NOT_AN_ENDPOINT));
  }

  getResponse(): Promise<ResponseEvent> {
    const stored = ipcStore.findResponse(this.id);
    return stored ? Promise.resolve(stored) : Promise.reject(new Error(NOT_AN_ENDPOINT));
  }

  setRequest(request: RequestEvent): Promise<void> {
    ipcStore.keepRequest(this.id, request);
    return Promise.reject(new Error(NOT_AN_ENDPOINT));
  }

  getRequest(): Promise<RequestEvent> {
    const stored = ipcStore.findRequest(this.id);
    return stored ? Promise.resolve(stored) : Promise.reject(new Error(NOT_AN_ENDPOINT));
  }

  destroy(): Promise<void> {
    ipcStore.forget(this.id);
    this.lambda.removeEventListener('message', this.onMessage);
    return Promise.resolve();
  }
}
