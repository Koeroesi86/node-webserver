import type { FrontMessage } from '../types';

const TYPES: unknown[] = [
  'hello',
  'ready',
  'failed',
  'stale',
  'plan',
  'prepared',
  'prepare-failed',
  'files',
  'reload-request',
  'target',
] satisfies FrontMessage['nodeWebserver'][];

/** whether a message of a front process is one of the server: a worker of a cluster may send others */
const isFrontMessage = (message: unknown): message is FrontMessage =>
  typeof message === 'object' && message !== null && 'nodeWebserver' in message && TYPES.includes(message.nodeWebserver);

export default isFrontMessage;
