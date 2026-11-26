import fs from 'fs';
import os from 'os';
import path from 'path';

/** answers with its version and the front that runs the server, which started the process */
const answer = (version: string) => `JSON.stringify({ version: '${version}', front: process.ppid })`;

const workerSource = (version: string) =>
  `module.exports = (event, callback) => callback({ statusCode: 200, headers: {}, body: ${answer(version)}, isBase64Encoded: false });`;

/**
 * The folder of the servers of the fixtures that answer with a version (`VERSIONED_SERVERS`): the files of a worker and a lambda of servers that are defined in the configuration,
 * and the file of a server of its own, which picks one of two workers by their version.
 */
export const createVersionedServers = () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'versioned-'));
  ['worker', 'filed'].forEach((name) => fs.mkdirSync(path.join(folder, name)));
  const write = (file: string, content: string) => fs.writeFileSync(path.join(folder, file), content);

  const writeWorker = (version: string) => write('worker/worker.js', workerSource(version));
  const writeLambda = (version: string) => write('lambda.js', `exports.handler = async () => ({ statusCode: 200, body: ${answer(version)} });`);
  const writeServer = (version: string) => {
    write(`filed/${version}.js`, workerSource(version));
    const server = { hostname: 'filed.localhost', protocol: 'http', type: 'worker', options: { root: path.join(folder, 'filed'), index: [`${version}.js`] } };
    write('server.js', `module.exports = ${JSON.stringify(server)};`);
  };

  return {
    folder,
    writeWorker,
    writeLambda,
    writeServer,
    breakServer: () => write('server.js', 'module.exports = {'),
    /** every server answers with this version */
    reset: (version: string) => [writeWorker, writeLambda, writeServer].forEach((writeFile) => writeFile(version)),
    remove: () => fs.rmSync(folder, { recursive: true, force: true }),
  };
};
