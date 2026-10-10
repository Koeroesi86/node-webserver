import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RunningServer } from './start-server';

/** how long the server may take to see a change of a file and load the servers again */
const reloadTimeout = 10000;

const workerRoot = path.resolve(__dirname, '../fixtures/worker');

/**
 * The folder of a server file the tests of the reload change. The file is given to the server through a link to its folder, which node loads modules from by
 * their real path (the temporary folder of macOS is such a link). The host name comes from a module the file loads, which has to be loaded again as well.
 */
export const createReloadedFolder = () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'reload-'));
  fs.mkdirSync(path.join(folder, 'real'));
  fs.symlinkSync(path.join(folder, 'real'), path.join(folder, 'link'), 'junction');
  const file = path.join(folder, 'link', 'server.js');

  const writeServer = (definition: object = { type: 'worker', options: { root: workerRoot, index: ['worker.js'] } }) =>
    fs.writeFileSync(file, `module.exports = { hostname: require('./hostname'), protocol: 'http', ...${JSON.stringify(definition)} };`);
  const writeHostname = (hostname: string) => fs.writeFileSync(path.join(folder, 'link', 'hostname.js'), `module.exports = '${hostname}';`);

  return { file, writeServer, writeHostname, remove: () => fs.rmSync(folder, { recursive: true, force: true }) };
};

/** waits until the condition holds, as the change is seen by the server some time after the file is written. The output of the server tells why when it does not. */
export const until = async (server: RunningServer, condition: () => Promise<boolean> | boolean) => {
  const deadline = Date.now() + reloadTimeout;
  while (!(await condition()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!(await condition())) {
    throw new Error(`The condition did not hold within ${reloadTimeout}ms. The output of the server:\n${server.output()}`);
  }
};

/** how many times the server loaded its servers again so far */
export const countReloads = (server: RunningServer) => server.output().split('Servers loaded again').length - 1;
