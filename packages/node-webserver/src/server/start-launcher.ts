import { createLauncher, forkServer, getFrontProcess, getLauncherMode } from '../cluster';

/**
 * Makes this process the launcher of the server, unless it is one that a launcher or a primary started: then there is nothing to do. The launcher runs this script again with the same arguments
 * as the server, starts it again when it asks for that, and passes everything else on. Returns whether this process is the launcher, which has nothing else to do then.
 */
const startLauncher = () => {
  if (getFrontProcess() || getLauncherMode()) return false;

  createLauncher({ fork: forkServer, log: (line) => console.error(`[launcher] ${line}`) }).start();

  return true;
};

export default startLauncher;
