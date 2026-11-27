import type { FrontMessage, ServerMessage } from '../types';

/** sends to the process that started this one, and resolves once the message left, also when it cannot: a parent that is gone takes the process with it anyway */
const sendMessage = (message: FrontMessage | ServerMessage) =>
  new Promise<void>((resolve) => {
    if (!process.send) return resolve();
    process.send(message, undefined, undefined, () => resolve());
  });

export default sendMessage;
