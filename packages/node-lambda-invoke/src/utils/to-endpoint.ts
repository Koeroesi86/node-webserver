import Worker from '../classes/Worker';
import type { IpcMessage } from './ipc-messages';

/** the side of the communication that exchanges messages through `on`, `off` and `send` */
export interface MessageEndpoint {
  on: (listener: (message: unknown) => void) => void;
  off: (listener: (message: unknown) => void) => void;
  send: (message: IpcMessage) => void;
}

export const toEndpoint = (instance: Worker | NodeJS.Process): MessageEndpoint => {
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
