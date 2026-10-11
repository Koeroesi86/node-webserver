import { gunzipSync } from 'zlib';
import http from 'http';
import net from 'net';
import { once } from 'events';
import { startServer } from './helpers/start-server';
import type { RunningServer } from './helpers/start-server';
import { connectWebSocket } from './helpers/websocket-client';

describe('the server', () => {
  let server: RunningServer;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(() => server.stop());

  it('answers 404 for a host that has no server', async () => {
    const reply = await server.get('nobody.localhost');

    expect(reply.status).toBe(404);
  });

  describe('of the type worker', () => {
    it('answers with what the worker responds with', async () => {
      const reply = await server.get('worker.localhost', '/?a=1&b=2');

      expect(reply.status).toBe(200);
      expect(reply.headers['x-handled-by']).toBe('worker');
      expect(reply.json()).toEqual({ method: 'GET', path: '/', query: { a: '1', b: '2' }, body: '' });
    });

    it('gives the body of the request to the worker', async () => {
      const reply = await server.get('worker.localhost', '/', { method: 'POST', body: 'ő upload', headers: { 'Content-Type': 'text/plain' } });

      expect(reply.json()).toMatchObject({ method: 'POST', body: 'ő upload' });
    });

    it('answers many requests at the same time', async () => {
      const replies = await Promise.all(Array.from({ length: 20 }, (_, index) => server.get('worker.localhost', `/?n=${index}`)));

      expect(replies.map((reply) => (reply.json() as { query: { n: string } }).query.n)).toEqual(Array.from({ length: 20 }, (_, index) => `${index}`));
    });

    it('leaves the response as it is unless compression is on', async () => {
      const reply = await server.get('worker.localhost', '/?size=5000', { headers: { 'Accept-Encoding': 'gzip' } });

      expect(reply.headers['content-encoding']).toBeUndefined();
      expect(reply.text).toBe('a'.repeat(5000));
    });

    it('compresses the response when compression is on and the client accepts it', async () => {
      const reply = await server.get('compressed.localhost', '/?size=5000', { headers: { 'Accept-Encoding': 'gzip' } });

      expect(reply.headers['content-encoding']).toBe('gzip');
      expect(reply.body.length).toBeLessThan(5000);
      expect(gunzipSync(reply.body).toString()).toBe('a'.repeat(5000));
    });

    it('does not compress for a client that does not accept it', async () => {
      const reply = await server.get('compressed.localhost', '/?size=5000');

      expect(reply.headers['content-encoding']).toBeUndefined();
      expect(reply.text).toBe('a'.repeat(5000));
    });
  });

  describe('of the type worker, for websockets', () => {
    const connect = () => connectWebSocket({ port: server.port, host: 'websocket.localhost' });

    it('sends the messages of the client back, text as text and binary as binary, whatever their size', async () => {
      const client = await connect();
      const big = 'ő'.repeat(60000);

      client.send('hello');
      client.send(Buffer.from([0, 1, 255]));
      client.send(big);

      expect(client.status).toBe(101);
      expect(await client.next()).toEqual({ opcode: 0x1, payload: Buffer.from('hello') });
      expect(await client.next()).toEqual({ opcode: 0x2, payload: Buffer.from([0, 1, 255]) });
      expect(await client.next()).toEqual({ opcode: 0x1, payload: Buffer.from(big) });
      client.close();
    });

    it('answers a ping', async () => {
      const client = await connect();

      client.ping('beat');

      expect(await client.next()).toEqual({ opcode: 0xa, payload: Buffer.from('beat') });
      client.close();
    });

    it('keeps handling the messages of many connections at the same time', async () => {
      const clients = await Promise.all(Array.from({ length: 10 }, connect));

      clients.forEach((client, index) => client.send(`message ${index}`));

      expect(await Promise.all(clients.map((client) => client.next()))).toEqual(
        clients.map((_, index) => ({ opcode: 0x1, payload: Buffer.from(`message ${index}`) }))
      );
      clients.forEach((client) => client.close());
    });

    it('takes a burst of big messages faster than the worker handles them, and answers every one of them in order', async () => {
      const client = await connect();

      Array.from({ length: 100 }, (_, index) => client.send(`${index}:${'y'.repeat(32 * 1024)}`));

      const answers = await Promise.all(Array.from({ length: 100 }, () => client.next()));
      expect(answers.map(({ payload }) => payload.toString().split(':')[0])).toEqual(Array.from({ length: 100 }, (_, index) => `${index}`));
      client.close();
    });

    it('delivers everything a worker sends to a client that reads slowly, without closing it', async () => {
      const client = await connectWebSocket({ port: server.port, host: 'websocket.localhost', path: '/flood' });

      client.pause();
      // the server has to hold back what the client does not read, from here on
      while (client.buffered() === 0) await new Promise((resolve) => setImmediate(resolve));
      client.resume();
      const messages = await Promise.all(Array.from({ length: 200 }, () => client.next()));

      expect(messages.map(({ opcode, payload }) => [opcode, payload.toString().split(':')[0]])).toEqual(
        Array.from({ length: 200 }, (_, index) => [0x1, `${index}`])
      );
      client.close();
    });

    it('closes a client that sends a message above the limit of the server', async () => {
      const client = await connect();

      client.send('x'.repeat(200001));
      const { opcode, payload } = await client.next();

      expect(opcode).toBe(0x8);
      expect(payload.readUInt16BE(0)).toBe(1009);
      await client.closed;
    });
  });

  describe.each([['lambda-ipc.localhost'], ['lambda-file.localhost']])('of the type lambda (%s)', (host) => {
    it('answers with what the lambda responds with', async () => {
      const reply = await server.get(host, '/hello?x=1', { method: 'PUT' });

      expect(reply.status).toBe(201);
      expect(reply.headers['x-handled-by']).toBe('lambda');
      expect(reply.json()).toEqual({ method: 'PUT', path: '/hello', query: { x: '1' } });
    });

    it('decodes a base64 body', async () => {
      const reply = await server.get(host, '/binary');

      expect([...reply.body]).toEqual([0, 1, 2, 255]);
    });

    it('answers 502 without the error of a lambda that fails, and keeps serving', async () => {
      const failed = await server.get(host, '/fail');
      const next = await server.get(host, '/after');

      expect(failed.status).toBe(502);
      expect(failed.text).not.toContain('boom');
      expect(next.status).toBe(201);
    });

    it('answers many requests at the same time', async () => {
      const replies = await Promise.all(Array.from({ length: 10 }, (_, index) => server.get(host, `/${index}`)));

      expect(replies.map((reply) => (reply.json() as { path: string }).path)).toEqual(Array.from({ length: 10 }, (_, index) => `/${index}`));
    });
  });

  describe('of the type lambda with routes', () => {
    const host = 'lambda-routes.localhost';

    it('runs the handler of the route, also for two handlers of one file', async () => {
      const list = await server.get(host, '/orders');
      const item = await server.get(host, '/orders/42?x=1');
      const again = await server.get(host, '/orders');

      expect(list.json()).toMatchObject({ handler: 'list', path: '/orders' });
      expect(item.json()).toMatchObject({ handler: 'get', path: '/orders/42', pathParameters: { id: '42' } });
      expect(again.json()).toMatchObject({ handler: 'list' });
      // each handler has a lambda of its own, so a request never gets the process of the other
      expect(item.headers['x-pid']).not.toBe(list.headers['x-pid']);
      expect(again.headers['x-pid']).toBe(list.headers['x-pid']);
    });

    it('runs the lambda of another file for another route', async () => {
      const reply = await server.get(host, '/other/thing');

      expect(reply.status).toBe(201);
      expect(reply.headers['x-handled-by']).toBe('lambda');
    });

    it('answers 404 itself for a path that no route matches', async () => {
      const reply = await server.get(host, '/orders/42/items');

      expect(reply.status).toBe(404);
      expect(reply.json()).toEqual({ message: 'Not Found' });
    });
  });

  describe('of the type child', () => {
    it('proxies the request to the application and its answer back', async () => {
      const reply = await server.get('child.localhost', '/some/path?q=1');

      expect(reply.status).toBe(200);
      expect(reply.headers['x-handled-by']).toBe('child');
      expect(reply.json()).toMatchObject({ method: 'GET', url: '/some/path?q=1' });
    });

    it('proxies the body of the request', async () => {
      const reply = await server.get('child.localhost', '/', { method: 'POST', body: 'ő proxied' });

      expect(reply.json()).toMatchObject({ method: 'POST', body: 'ő proxied' });
    });
  });

  describe('of the type proxy', () => {
    const controlPath = '/.well-known/node-webserver/proxy';
    const control = (method: string, body?: object, headers: http.OutgoingHttpHeaders = {}) =>
      server.get('proxy.localhost', controlPath, {
        method,
        body: body && JSON.stringify(body),
        headers: { Authorization: 'Bearer integration-token', 'X-Forwarded-Proto': 'https', ...headers },
      });
    let upstream: http.Server;
    let upstreamPort: number;

    beforeAll(async () => {
      // an application that knows nothing of the server in front of it, and echoes a websocket
      upstream = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json', Server: 'upstream' });
        response.end(JSON.stringify({ url: request.url, host: request.headers.host, forwardedFor: request.headers['x-forwarded-for'] }));
      });
      upstream.on('upgrade', (request: http.IncomingMessage, socket: net.Socket) => {
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
        socket.pipe(socket);
      });
      upstream.listen(0, '127.0.0.1');
      await once(upstream, 'listening');
      const address = upstream.address();
      upstreamPort = address && typeof address === 'object' ? address.port : 0;
    });

    afterAll(async () => {
      upstream.closeAllConnections();
      await new Promise((resolve) => upstream.close(resolve));
    });

    it('answers 502 when the target cannot be reached', async () => {
      expect((await server.get('proxy-down.localhost')).status).toBe(502);
    });

    it('answers 503 before a target is registered, and refuses a registration without the token or over plain http', async () => {
      expect((await server.get('proxy.localhost')).status).toBe(503);
      expect((await control('PUT', { port: upstreamPort }, { Authorization: 'Bearer wrong' })).status).toBe(401);
      expect((await control('PUT', { port: upstreamPort }, { 'X-Forwarded-Proto': 'http' })).status).toBe(403);
    });

    it('passes the requests on to the target the application registered, websockets too', async () => {
      const registered = await control('PUT', { port: upstreamPort });
      const reply = await server.get('proxy.localhost', '/some/path?q=1', { headers: { 'X-Forwarded-For': '1.2.3.4' } });

      expect(registered.json()).toMatchObject({ target: `http://127.0.0.1:${upstreamPort}/` });
      expect(reply.status).toBe(200);
      // the front server trusts the loopback address in these tests, so the chain is kept and its peer added
      expect(reply.json()).toEqual({ url: '/some/path?q=1', host: 'proxy.localhost', forwardedFor: '1.2.3.4, 127.0.0.1' });

      const socket = net.connect(server.port, '127.0.0.1');
      let received = '';
      const echoed = new Promise<void>((resolve) =>
        socket.on('data', (data: Buffer) => {
          received += data.toString('utf8');
          if (received.endsWith('\r\n\r\n')) socket.write('ping');
          if (received.endsWith('ping')) resolve();
        })
      );
      socket.write('GET / HTTP/1.1\r\nHost: proxy.localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      await echoed;
      socket.destroy();

      expect(received).toMatch(/^HTTP\/1.1 101 Switching Protocols\r\n/);
    });
  });
});
