import { MESSAGES, isIpcMessage } from '../utils/ipc-messages';
import { ipcStore } from '../utils/ipc-store';
import { exchangeMessage } from '../utils/exchange-message';
import sendToParent from '../utils/sendToParent';
import { storeRequest } from '../utils/store-request';
import { toEndpoint } from '../utils/to-endpoint';
import type Worker from './Worker';
import type RequestEvent from './RequestEvent';
import type ResponseEvent from './ResponseEvent';
import type { Storage } from '../types';
import type { IpcMessage, SetRequestMessage, SetResponseMessage } from '../utils/ipc-messages';

/** the storage that talks to the other process through the messages of the worker or of the process itself */
export class IPCExecutorStorage implements Storage {
  private readonly endpoint;

  constructor(
    readonly id: string,
    instance: Worker | NodeJS.Process
  ) {
    this.endpoint = toEndpoint(instance);
    this.endpoint.on(this.onMessage);
  }

  private onMessage = (message: unknown) => {
    if (!isIpcMessage(message)) return;

    storeRequest(message);

    const response = message.type === MESSAGES.GET_RESPONSE ? ipcStore.findResponse(message.id) : undefined;
    if (response) sendToParent({ type: MESSAGES.SET_RESPONSE, id: message.id, payload: response });
  };

  setResponse(response: ResponseEvent): Promise<void> {
    ipcStore.keepResponse(this.id, response);
    return (
      exchangeMessage(
        this.endpoint,
        { type: MESSAGES.SET_RESPONSE, id: this.id, payload: response },
        (answer: IpcMessage): answer is IpcMessage => answer.type === MESSAGES.SET_RESPONSE_FINISHED && answer.id === this.id
      )
        // the other side has the response now and the request is answered, nothing asks this process for either again
        .then(() => this.destroy())
    );
  }

  getResponse(): Promise<ResponseEvent> {
    const stored = ipcStore.findResponse(this.id);
    if (stored) return Promise.resolve(stored);

    return exchangeMessage(
      this.endpoint,
      { type: MESSAGES.GET_RESPONSE, id: this.id },
      (answer): answer is SetResponseMessage => answer.type === MESSAGES.SET_RESPONSE && answer.id === this.id
    ).then(({ payload }) => {
      ipcStore.keepResponse(this.id, payload);
      return payload;
    });
  }

  setRequest(request: RequestEvent): Promise<void> {
    ipcStore.keepRequest(this.id, request);
    return exchangeMessage(
      this.endpoint,
      { type: MESSAGES.SET_REQUEST, id: this.id, payload: request },
      (answer: IpcMessage): answer is IpcMessage => answer.type === MESSAGES.SET_REQUEST_FINISHED && answer.id === this.id
    ).then(() => undefined);
  }

  getRequest(): Promise<RequestEvent> {
    const stored = ipcStore.findRequest(this.id);
    if (stored) return Promise.resolve(stored);

    return exchangeMessage(
      this.endpoint,
      { type: MESSAGES.GET_REQUEST, id: this.id },
      (answer): answer is SetRequestMessage => answer.type === MESSAGES.SET_REQUEST && answer.id === this.id
    ).then(({ payload }) => {
      ipcStore.keepRequest(this.id, payload);
      return payload;
    });
  }

  destroy(): Promise<void> {
    ipcStore.forget(this.id);
    this.endpoint.off(this.onMessage);
    return Promise.resolve();
  }
}
