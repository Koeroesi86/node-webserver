import { once } from 'events';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { startServer } from './helpers/start-server';
import type { RunningServer } from './helpers/start-server';

/** how long the server may take to see a change of a file and load the servers again */
const reloadTimeout = 10000;

describe('the server, when the file of a server changes', () => {
  let folder: string;
  let server: RunningServer;
  // the file is given to the server through a link to its folder, which node loads modules from by their real path (the temporary folder of macOS is such a link)
  const file = () => path.join(folder, 'link', 'server.js');
  const writeHostname = (hostname: string) => fs.writeFileSync(path.join(folder, 'link', 'hostname.js'), `module.exports = '${hostname}';`);
  // the host name comes from a module the file loads, which has to be loaded again as well
  const writeServer = (definition: object = { type: 'worker', options: { root: path.resolve(__dirname, 'fixtures/worker'), index: ['worker.js'] } }) =>
    fs.writeFileSync(file(), `module.exports = { hostname: require('./hostname'), protocol: 'http', ...${JSON.stringify(definition)} };`);

  /** waits until the condition holds, as the change is seen by the server some time after the file is written. The output of the server tells why when it does not. */
  const until = async (condition: () => Promise<boolean> | boolean) => {
    const deadline = Date.now() + reloadTimeout;
    while (!(await condition()) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!(await condition())) {
      throw new Error(`The condition did not hold within ${reloadTimeout}ms. The output of the server:\n${server.output()}`);
    }
  };
  const status = async (host: string) => (await server.get(host)).status;
  /** the tests do not depend on each other, as a test that fails is run again after the others: each one starts from a server of its own host name */
  const serve = async (hostname: string) => {
    writeServer();
    writeHostname(hostname);
    await until(async () => (await status(hostname)) === 200);
  };

  beforeAll(async () => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'reload-'));
    fs.mkdirSync(path.join(folder, 'real'));
    fs.symlinkSync(path.join(folder, 'real'), path.join(folder, 'link'), 'junction');
    writeServer();
    writeHostname('first.localhost');
    server = await startServer({ RELOADED_SERVER: file() });
  });

  afterAll(async () => {
    await server.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it('serves the changed server, without a restart', async () => {
    await serve('first.localhost');

    writeHostname('second.localhost');

    await until(async () => (await status('second.localhost')) === 200);
    expect(await status('first.localhost')).toBe(404);
    // the other servers kept running
    expect(await status('worker.localhost')).toBe(200);
  });

  it('keeps the running server when the file is broken', async () => {
    await serve('third.localhost');

    fs.writeFileSync(file(), 'module.exports = {');

    await until(() => server.output().includes('The servers were not loaded again'));
    expect(await status('third.localhost')).toBe(200);
  });

  it('stops serving a server whose file was removed, and loads it anew with the modules it loads when it comes back', async () => {
    await serve('fourth.localhost');

    fs.rmSync(file());

    await until(async () => (await status('fourth.localhost')) === 404);

    writeHostname('fourth-again.localhost');
    writeServer();

    await until(async () => (await status('fourth-again.localhost')) === 200);
    expect(await status('fourth.localhost')).toBe(404);
  });

  it('keeps the target that was registered with a proxy server whose file changed', async () => {
    const upstream = http.createServer((request, response) => {
      response.writeHead(200, { Server: 'upstream' });
      response.end();
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const address = upstream.address();
    // the loopback address is trusted in these tests, which makes the request come over https and lets the target be a private address
    const proxy = (hideHeaders: string[]) => ({ type: 'proxy', proxyOptions: { hideHeaders, dynamic: { token: 'reload-token', allowPrivate: true } } });

    try {
      writeServer(proxy([]));
      writeHostname('fifth.localhost');
      await until(async () => (await status('fifth.localhost')) === 503);
      const registered = await server.get('fifth.localhost', '/.well-known/node-webserver/proxy', {
        method: 'PUT',
        body: JSON.stringify({ port: address && typeof address === 'object' ? address.port : 0 }),
        headers: { Authorization: 'Bearer reload-token', 'X-Forwarded-Proto': 'https' },
      });
      expect(registered.status).toBe(200);
      expect((await server.get('fifth.localhost')).headers.server).toBe('upstream');

      writeServer(proxy(['server']));

      await until(async () => (await server.get('fifth.localhost')).headers.server === undefined);
      expect(await status('fifth.localhost')).toBe(200);
    } finally {
      upstream.closeAllConnections();
      upstream.close();
    }
  });
});
