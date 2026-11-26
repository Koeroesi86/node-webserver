import type { PrimaryMessage } from '../types';

const TYPES: unknown[] = ['signal', 'prepare', 'commit', 'discard', 'stop'] satisfies PrimaryMessage['nodeWebserver'][];

/** whether a message to a front is one of the primary: the process may get messages of others */
const isPrimaryMessage = (message: unknown): message is PrimaryMessage =>
  typeof message === 'object' && message !== null && 'nodeWebserver' in message && TYPES.includes(message.nodeWebserver);

export default isPrimaryMessage;
