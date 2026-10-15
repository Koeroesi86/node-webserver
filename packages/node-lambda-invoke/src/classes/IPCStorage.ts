import Lambda from './Lambda';
import { IPCExecutorStorage } from './IPCExecutorStorage';
import { IPCInvokerStorage } from './IPCInvokerStorage';
import { MESSAGES, isIpcMessage } from '../utils/ipc-messages';
import { ipcStore } from '../utils/ipc-store';
import { storeRequest } from '../utils/store-request';
import sendToParent from '../utils/sendToParent';
import { bindStorageMethods } from '../utils/bind-storage-methods';
import type RequestEvent from './RequestEvent';
import type ResponseEvent from './ResponseEvent';
import type { Storage, StorageInstance } from '../types';

process.on('message', (message) => {
  if (!isIpcMessage(message)) return;

  storeRequest(message);

  if (message.type === MESSAGES.SET_RESPONSE) {
    ipcStore.keepResponse(message.id, message.payload);
    sendToParent({ type: MESSAGES.SET_RESPONSE_FINISHED, id: message.id });
  }
});

/** loaded by file path, so it has to stay a CommonJS `module.exports` */
class IPCStorage implements Storage {
  static start() {
    ipcStore.reset();
  }

  private readonly role: Storage;

  constructor(
    readonly id: string,
    instance: StorageInstance
  ) {
    this.role = instance instanceof Lambda ? new IPCInvokerStorage(id, instance) : new IPCExecutorStorage(id, instance);
    bindStorageMethods(this);
  }

  setResponse(response: ResponseEvent) {
    return this.role.setResponse(response);
  }

  getResponse(): Promise<ResponseEvent> {
    return this.role.getResponse();
  }

  setRequest(request: RequestEvent) {
    return this.role.setRequest(request);
  }

  getRequest(): Promise<RequestEvent> {
    return this.role.getRequest();
  }

  destroy() {
    return this.role.destroy();
  }
}

export = IPCStorage;
