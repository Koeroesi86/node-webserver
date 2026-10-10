import { resolve } from 'node:path';
import type { CreateChannel } from '../types/channel-bench';

/** The channel of the built node-worker-express, the one the server and its workers use, so it is measured as it is and not a copy of it. Needs `pnpm build`. */
export const loadCreateChannel = (): CreateChannel => require(resolve(__dirname, '../../../packages/node-worker-express/dist/utils/createChannel.js')).default;
