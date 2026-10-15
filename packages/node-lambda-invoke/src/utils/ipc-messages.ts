import type RequestEvent from '../classes/RequestEvent';
import type ResponseEvent from '../classes/ResponseEvent';

export const MESSAGES = {
  GET_RESPONSE: 'GW_GET_RESPONSE',
  SET_RESPONSE: 'GW_SET_RESPONSE',
  SET_RESPONSE_FINISHED: 'GW_SET_RESPONSE_FINISHED',
  GET_REQUEST: 'GW_GET_REQUEST',
  SET_REQUEST: 'GW_SET_REQUEST',
  SET_REQUEST_FINISHED: 'GW_SET_REQUEST_FINISHED',
} as const;

export type SetRequestMessage = { type: typeof MESSAGES.SET_REQUEST; id: string; payload: RequestEvent };
export type SetResponseMessage = { type: typeof MESSAGES.SET_RESPONSE; id: string; payload: ResponseEvent };

export type IpcMessage =
  | SetRequestMessage
  | SetResponseMessage
  | {
      type: typeof MESSAGES.GET_RESPONSE | typeof MESSAGES.GET_REQUEST | typeof MESSAGES.SET_RESPONSE_FINISHED | typeof MESSAGES.SET_REQUEST_FINISHED;
      id: string;
    };

export const isIpcMessage = (message: unknown): message is IpcMessage =>
  typeof message === 'object' && message !== null && 'type' in message && 'id' in message;
