import { fork } from 'child_process';
import { LAUNCHER_ENV } from '../constants';
import type { LauncherMode, PrimaryMessage } from '../types';

/** starts the server for the launcher: this script with the same arguments, which is told that the launcher started it. Its output goes where the one of the launcher goes. */
const forkServer = (mode: LauncherMode) => {
  const child = fork(process.argv[1], process.argv.slice(2), { env: { ...process.env, [LAUNCHER_ENV]: mode } });

  return {
    pid: child.pid,
    send: (message: PrimaryMessage) => {
      if (child.connected) child.send(message, () => {});
    },
    onMessage: (listener: (message: unknown) => void) => child.on('message', listener),
    onExit: (listener: (code: number | null, signal: string | null) => void) => {
      child.on('exit', listener);
      // a process that could not be started has no exit
      // eslint-disable-next-line no-restricted-syntax -- node says null for the signal of a process that ended by none
      child.once('error', () => child.pid === undefined && listener(1, null));
    },
  };
};

export default forkServer;
