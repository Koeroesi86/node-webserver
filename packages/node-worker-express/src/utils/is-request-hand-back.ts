import { WORKER_EVENT } from '../constants';
import type { RequestHandBackMessage } from '../types';

/** whether a message of the IPC channel gives the connection of a handed over request back, which the server has to check as it is parsed JSON */
const isRequestHandBack = (message: unknown): message is RequestHandBackMessage =>
  typeof message === 'object' &&
  message !== null &&
  'type' in message &&
  message.type === WORKER_EVENT.REQUEST_HANDBACK &&
  'requestId' in message &&
  typeof message.requestId === 'string' &&
  'event' in message &&
  typeof message.event === 'object' &&
  'leftover' in message &&
  typeof message.leftover === 'string';

export default isRequestHandBack;
