import type { ServerMessage } from '../types';

const TYPES: unknown[] = ['hello', 'serving'] satisfies ServerMessage['nodeWebserver'][];

/** whether a message to a launcher is one of the server: the process it started may send others */
const isServerMessage = (message: unknown): message is ServerMessage =>
  typeof message === 'object' && message !== null && 'nodeWebserver' in message && TYPES.includes(message.nodeWebserver);

export default isServerMessage;
