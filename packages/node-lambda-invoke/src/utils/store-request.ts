import { MESSAGES } from './ipc-messages';
import { ipcStore } from './ipc-store';
import sendToParent from './sendToParent';
import type { IpcMessage } from './ipc-messages';

/** the request the invoker sends is kept, and the invoker is told */
export const storeRequest = (message: IpcMessage) => {
  if (message.type !== MESSAGES.SET_REQUEST) return;

  ipcStore.keepRequest(message.id, message.payload);
  sendToParent({ type: MESSAGES.SET_REQUEST_FINISHED, id: message.id });
};
