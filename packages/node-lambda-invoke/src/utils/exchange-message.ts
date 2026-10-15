import { isIpcMessage } from './ipc-messages';
import type { IpcMessage } from './ipc-messages';
import type { MessageEndpoint } from './to-endpoint';

/** sends a message and waits for the answer. The listener is there before the message goes, so that a quick answer is not missed. */
export const exchangeMessage = <T extends IpcMessage>(
  endpoint: MessageEndpoint,
  message: IpcMessage,
  isAnswer: (answer: IpcMessage) => answer is T
): Promise<T> =>
  new Promise((resolve) => {
    const listener = (answer: unknown) => {
      if (!isIpcMessage(answer) || !isAnswer(answer)) return;

      endpoint.off(listener);
      resolve(answer);
    };
    endpoint.on(listener);
    endpoint.send(message);
  });
