import fs from 'fs';
import os from 'os';
import path from 'path';
import { countReloads, until as untilHolds } from './helpers/reloaded-folder';
import { startServer } from './helpers/start-server';
import type { RunningServer } from './helpers/start-server';

describe('the server, when the files of a worker are replaced through a link', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'reload-link-'));
  const link = path.join(folder, 'build');
  const gate = path.join(folder, 'gate');
  const file = path.join(folder, 'server.js');
  let server: RunningServer;

  /** a release answers with its name, and a request with `hold` waits until the gate file is gone */
  const release = (name: string) => {
    const root = path.join(folder, `build.${name}`);
    fs.mkdirSync(root);
    fs.writeFileSync(
      path.join(root, 'worker.js'),
      `const fs = require('fs');
       module.exports = async (event, callback) => {
         while (event.queryStringParameters.hold && fs.existsSync(${JSON.stringify(gate)})) await new Promise((resolve) => setTimeout(resolve, 20));
         callback({ statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: ${JSON.stringify(name)}, isBase64Encoded: false });
       };`
    );
    return root;
  };
  /** the way a deploy does it: a new link next to the old one, renamed over it */
  const point = (root: string) => {
    fs.symlinkSync(root, `${link}.next`, 'junction');
    // windows cannot rename a link over another, a deploy there removes the old one first
    if (process.platform === 'win32') {
      fs.rmSync(link);
    }
    fs.renameSync(`${link}.next`, link);
  };
  const body = async () => (await server.get('linked.localhost')).body.toString();

  beforeAll(async () => {
    const first = release('one');
    const second = release('two');
    fs.symlinkSync(first, link, 'junction');
    fs.writeFileSync(
      file,
      `module.exports = { hostname: 'linked.localhost', protocol: 'http', type: 'worker', options: { root: ${JSON.stringify(link)}, index: ['worker.js'] } };`
    );
    server = await startServer({ RELOADED_SERVER: file, SYSTEM_LOGS: 'true' });
    expect(second).toBeDefined();
  });

  afterAll(async () => {
    await server.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it('serves the new release to the new requests, and lets a request on the old one finish', async () => {
    await untilHolds(server, async () => (await body()) === 'one');
    fs.writeFileSync(gate, '');
    const inFlight = server.get('linked.localhost', '/?hold=1');

    point(path.join(folder, 'build.two'));

    await untilHolds(server, () => countReloads(server) === 1);
    expect(await body()).toBe('two');
    fs.rmSync(gate);
    expect((await inFlight).body.toString()).toBe('one');
  });
});
