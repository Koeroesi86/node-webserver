import cluster from 'cluster';
import { FRONT_PROCESS_ENV } from '../constants';
import type { FrontHandle, FrontProcess } from '../types';

/** starts a front: this script with the same arguments, as a worker of the cluster, which is told its place in the environment */
const forkFront = (front: FrontProcess): FrontHandle => {
  const worker = cluster.fork({ [FRONT_PROCESS_ENV]: JSON.stringify(front) });
  // a front that cannot be reached any more ends, which its exit says
  worker.on('error', () => {});

  return {
    pid: worker.process.pid,
    send: (message) => {
      if (worker.isConnected()) worker.send(message, () => {});
    },
    kill: () => worker.process.kill('SIGKILL'),
    onMessage: (listener) => worker.on('message', listener),
    onExit: (listener) => {
      worker.on('exit', listener);
      // a process that could not be started has no exit
      // eslint-disable-next-line no-restricted-syntax -- node says null for the exit code of a process that has none
      worker.once('error', () => worker.process.pid === undefined && listener(null, 'a failure to start'));
    },
  };
};

export default forkFront;
