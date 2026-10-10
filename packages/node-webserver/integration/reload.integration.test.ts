import { once } from 'events';
import fs from 'fs';
import http from 'http';
import { createReloadedFolder, until as untilHolds } from './helpers/reloaded-folder';
import { startServer } from './helpers/start-server';
import type { RunningServer } from './helpers/start-server';

describe('the server, when the file of a server changes', () => {
  const { file, writeServer, writeHostname, remove } = createReloadedFolder();
  let server: RunningServer;

  const until = (condition: () => Promise<boolean> | boolean) => untilHolds(server, condition);
  const status = async (host: string) => (await server.get(host)).status;
  /** the tests do not depend on each other, as a test that fails is run again after the others: each one starts from a server of its own host name */
  const serve = async (hostname: string) => {
    writeServer();
    writeHostname(hostname);
    await until(async () => (await status(hostname)) === 200);
  };

  beforeAll(async () => {
    writeServer();
    writeHostname('first.localhost');
    server = await startServer({ RELOADED_SERVER: file });
  });

  afterAll(async () => {
    await server.stop();
    remove();
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

    fs.writeFileSync(file, 'module.exports = {');

    await until(() => server.output().includes('The servers were not loaded again'));
    expect(await status('third.localhost')).toBe(200);
  });

  it('stops serving a server whose file was removed, and loads it anew with the modules it loads when it comes back', async () => {
    await serve('fourth.localhost');

    fs.rmSync(file);

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
