import net from 'net';
import { WORKER_EVENT } from '../constants';
import type { InvokableWorker } from '../types';
import createWorkerSession from './create-worker-session';

/**
 * The code of a process that is a worker: opens the channel the pool made as the fourth stdio, serves the requests that come over it with `worker`, and tells the pool it is ready.
 * A runner that loads its file asynchronously calls it once the file is loaded, so that the pool hands out the process only then.
 */
const startWorkerProcess = (worker: InvokableWorker): void => {
  const channelSocket = new net.Socket({ fd: 3, readable: true, writable: true });
  const session = createWorkerSession(worker, channelSocket);

  process.on('message', session.receiveHandOff);

  // the parent can disappear without running its exit handlers, for example when it is terminated by a signal, which closes the channel
  channelSocket.on('close', () => process.exit(0));
  session.announceReady();
};

export default startWorkerProcess;
