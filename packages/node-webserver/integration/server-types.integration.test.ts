import { gunzipSync } from 'zlib';
import { startServer } from './helpers/start-server';
import type { RunningServer } from './helpers/start-server';

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

    it('answers 500 with the error of a lambda that fails, and keeps serving', async () => {
      const failed = await server.get(host, '/fail');
      const next = await server.get(host, '/after');

      expect(failed.status).toBe(500);
      expect(failed.text).toContain('boom');
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
