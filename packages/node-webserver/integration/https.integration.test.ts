import http2 from 'http2';
import https from 'https';
import { startServer } from './helpers/start-server';
import { connectWebSocket } from './helpers/websocket-client';
import type { RunningServer } from './helpers/start-server';

interface Reply {
  status: number;
  version: string;
  body: Buffer;
  json: () => { method: string; path: string; query: Record<string, string>; body: string };
}

describe('the https port with http2 on', () => {
  let server: RunningServer;
  let session: http2.ClientHttp2Session;

  beforeAll(async () => {
    server = await startServer();
    // the certificate is self signed, and the name of the host is asked for through the authority
    session = http2.connect(`https://secure.localhost:${server.httpsPort}`, { host: '127.0.0.1', servername: 'secure.localhost', rejectUnauthorized: false });
  });

  afterAll(async () => {
    session.destroy();
    await server.stop();
  });

  const getHttp2 = (path: string, { method = 'GET', body, authority = 'secure.localhost' }: { method?: string; body?: string; authority?: string } = {}) =>
    new Promise<Reply>((resolve, reject) => {
      const stream = session.request({ ':method': method, ':path': path, ':authority': authority, ...(body && { 'content-type': 'text/plain' }) });
      const parts: Buffer[] = [];
      let status = 0;
      stream.on('response', (headers) => (status = Number(headers[':status'])));
      stream.on('data', (part: Buffer) => parts.push(part));
      stream.on('error', reject);
      stream.on('end', () => {
        const buffer = Buffer.concat(parts);
        resolve({ status, version: '2.0', body: buffer, json: () => JSON.parse(buffer.toString('utf8')) });
      });
      stream.end(body);
    });

  const getHttp1 = (host: string, path: string) =>
    new Promise<Reply>((resolve, reject) => {
      https
        .get(
          { host: '127.0.0.1', port: server.httpsPort, path, servername: host, headers: { Host: host }, rejectUnauthorized: false, agent: false },
          (response) => {
            const parts: Buffer[] = [];
            response.on('data', (part: Buffer) => parts.push(part));
            response.on('end', () => {
              const buffer = Buffer.concat(parts);
              resolve({ status: response.statusCode ?? 0, version: response.httpVersion, body: buffer, json: () => JSON.parse(buffer.toString('utf8')) });
            });
          }
        )
        .on('error', reject);
    });

  it('serves a worker over HTTP/2, with the host taken from the authority', async () => {
    const reply = await getHttp2('/?a=1');

    expect(reply.status).toBe(200);
    expect(reply.json()).toEqual({ method: 'GET', path: '/', query: { a: '1' }, body: '' });
  });

  it('gives the body of an HTTP/2 request to the worker', async () => {
    const reply = await getHttp2('/', { method: 'POST', body: 'ő upload' });

    expect(reply.json()).toMatchObject({ method: 'POST', body: 'ő upload' });
  });

  it('answers many requests at the same time over one connection', async () => {
    const replies = await Promise.all(Array.from({ length: 50 }, (_, index) => getHttp2(`/?n=${index}`, { method: 'POST', body: `body ${index}` })));

    expect(replies.map((reply) => reply.json().body)).toEqual(Array.from({ length: 50 }, (_, index) => `body ${index}`));
    expect(replies.map((reply) => reply.json().query.n)).toEqual(Array.from({ length: 50 }, (_, index) => `${index}`));
  });

  it('routes by the authority of the request', async () => {
    const known = await getHttp2('/', { authority: 'secure.localhost' });
    const unknown = await getHttp2('/', { authority: 'nobody.localhost' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(404);
  });

  it('keeps the connection open when a request is refused', async () => {
    const refused = await getHttp2('/../etc').catch(() => undefined);
    const next = await getHttp2('/?after=1');

    expect(refused?.status).not.toBe(200);
    expect(next.json().query.after).toBe('1');
  });

  it('serves a client of HTTP/1.1 on the same port', async () => {
    const reply = await getHttp1('secure.localhost', '/?a=1');

    expect(reply.version).toBe('1.1');
    expect(reply.json()).toEqual({ method: 'GET', path: '/', query: { a: '1' }, body: '' });
  });

  it('keeps websockets working over HTTP/1.1 on the same port', async () => {
    const client = await connectWebSocket({ port: server.httpsPort, host: 'secure-websocket.localhost', secure: true });

    client.send('hello');

    expect(client.status).toBe(101);
    expect(await client.next()).toEqual({ opcode: 0x1, payload: Buffer.from('hello') });
    client.close();
  });
});
