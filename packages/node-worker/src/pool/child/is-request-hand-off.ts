import { WORKER_EVENT } from '../constants';
import type { RequestHandOffMessage } from '../types';

/** whether a message of the IPC channel hands over the connection of a request, which the worker has to check as it is parsed JSON */
const isRequestHandOff = (message: unknown): message is RequestHandOffMessage =>
  typeof message === 'object' &&
  message !== null &&
  'type' in message &&
  message.type === WORKER_EVENT.REQUEST_HANDOFF &&
  'requestId' in message &&
  typeof message.requestId === 'string' &&
  'event' in message &&
  typeof message.event === 'object' &&
  'prefix' in message &&
  typeof message.prefix === 'string' &&
  'length' in message &&
  typeof message.length === 'number' &&
  'timeout' in message &&
  typeof message.timeout === 'number';

export default isRequestHandOff;
