import { gunzipSync } from 'zlib';
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
});
