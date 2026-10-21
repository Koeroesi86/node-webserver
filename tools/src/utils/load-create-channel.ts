import { resolve } from 'node:path';
import type { CreateChannel } from '../types/channel-bench';

/** The channel of the built worker pool of node-worker, the one the server and its workers use, so it is measured as it is and not a copy of it. Needs `pnpm build`. */
export const loadCreateChannel = (): CreateChannel => require(resolve(__dirname, '../../../packages/node-worker/dist/pool/utils/createChannel.js')).default;
