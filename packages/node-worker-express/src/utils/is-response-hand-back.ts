import { WORKER_EVENT } from '../constants';
import type { ResponseHandBackMessage } from '../types';

/** whether a message of the IPC channel gives the connection of a handed over response back, which the server has to check as it is parsed JSON */
const isResponseHandBack = (message: unknown): message is ResponseHandBackMessage =>
  typeof message === 'object' &&
  message !== null &&
  'type' in message &&
  message.type === WORKER_EVENT.RESPONSE_HANDBACK &&
  'requestId' in message &&
  typeof message.requestId === 'string' &&
  'leftover' in message &&
  typeof message.leftover === 'string';

export default isResponseHandBack;
