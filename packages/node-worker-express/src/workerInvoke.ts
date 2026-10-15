import net from 'net';
import { InvokableWorker } from './types';
import createWorkerSession from './utils/create-worker-session';

const worker = require(process.argv.pop()) as InvokableWorker;

/** the socket pair to the server, which the pool opens as the fourth stdio of the worker */
const channelSocket = new net.Socket({ fd: 3, readable: true, writable: true });
const session = createWorkerSession(worker, channelSocket);

process.on('message', session.receiveHandOff);

// the parent can disappear without running its exit handlers, for example when it is terminated by a signal, which closes the channel
channelSocket.on('close', () => process.exit(0));
