import { createLauncher, forkServer, getFrontProcess, getLauncherMode, getStableScriptPath } from '../cluster';

/**
 * Makes this process the launcher of the server, unless it is one that a launcher or a primary started: then there is nothing to do. The launcher runs this script again with the same arguments
 * as the server, starts it again when it asks for that, and passes everything else on. Returns whether this process is the launcher, which has nothing else to do then.
 */
const startLauncher = () => {
  if (getFrontProcess() || getLauncherMode()) return false;

  // worked out now, before an update, as the path has to lead to the next version when the server is started again
  const script = getStableScriptPath(process.argv[1]);
  createLauncher({ fork: (mode) => forkServer(mode, script), log: (line) => console.error(`[launcher] ${line}`) }).start();

  return true;
};

export default startLauncher;
