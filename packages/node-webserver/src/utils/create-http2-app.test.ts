import http2 from 'http2';
import zlib from 'zlib';
import type { Express, Request, Response } from 'express';
import type { AddressInfo } from 'net';
import compressionMiddleware from '../middlewares/compression';
import createHttp2App from './create-http2-app';

interface Reply {
  status: number;
  headers: http2.IncomingHttpHeaders;
  body: Buffer;
}

/** answers with what the handlers see of the request, after its body was read */
const echo = (request: Request, response: Response) => {
  const parts: Buffer[] = [];
  request.on('data', (part: Buffer) => parts.push(part));
  request.on('end', () =>
    response.status(201).json({
      method: request.method,
      url: request.url,
      path: request.path,
      hostname: request.hostname,
      headers: request.headers,
      body: Buffer.concat(parts).toString(),
    })
  );
};

describe('createHttp2App', () => {
  const servers: http2.Http2Server[] = [];
  const sessions: http2.ClientHttp2Session[] = [];

  afterEach(async () => {
    sessions.splice(0).forEach((session) => session.destroy());
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  /** a server of HTTP/2 without TLS, and a client that is connected to it */
  const connect = async (app: Express) => {
    const server = http2.createServer();
    // the types of node know only the requests of HTTP/2 here, which is what the app is made for
    server.on('request', app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const session = http2.connect(`http://web.localhost:${(server.address() as AddressInfo).port}`, {
      host: '127.0.0.1',
      lookup: (_, __, done) => done(null, '127.0.0.1', 4),
    });
    sessions.push(session);

    return session;
  };

  const send = (session: http2.ClientHttp2Session, headers: http2.OutgoingHttpHeaders, body?: string) =>
    new Promise<Reply>((resolve, reject) => {
      const stream = session.request(headers);
      const parts: Buffer[] = [];
      let replyHeaders: http2.IncomingHttpHeaders = {};
      stream.on('response', (received) => (replyHeaders = received));
      stream.on('data', (part: Buffer) => parts.push(part));
      stream.on('end', () => resolve({ status: Number(replyHeaders[':status']), headers: replyHeaders, body: Buffer.concat(parts) }));
      stream.on('error', reject);
      stream.end(body);
    });

  const app = () => {
    const created = createHttp2App();
    created.use(echo);
    return created;
  };

  it('reads the body of a request', async () => {
    const session = await connect(app());

    const reply = await send(session, { ':method': 'POST', ':path': '/upload?x=1', 'content-type': 'text/plain' }, 'ő upload');

    expect(reply.status).toBe(201);
    expect(JSON.parse(reply.body.toString())).toMatchObject({ method: 'POST', url: '/upload?x=1', path: '/upload', body: 'ő upload' });
  });

  it('answers many requests at the same time over one connection', async () => {
    const session = await connect(app());

    const replies = await Promise.all(Array.from({ length: 50 }, (_, index) => send(session, { ':method': 'POST', ':path': `/${index}` }, `body ${index}`)));

    expect(replies.map((reply) => JSON.parse(reply.body.toString()))).toEqual(
      Array.from({ length: 50 }, (_, index) => expect.objectContaining({ url: `/${index}`, body: `body ${index}` }))
    );
  });

  it('takes the host from the authority, and gives the handlers the headers without the pseudo headers', async () => {
    const session = await connect(app());

    const reply = await send(session, { ':method': 'GET', ':path': '/', ':authority': 'secure.localhost', 'x-custom': 'yes' });
    const { hostname, headers } = JSON.parse(reply.body.toString());

    expect(hostname).toBe('secure.localhost');
    expect(headers).toMatchObject({ host: 'secure.localhost', 'x-custom': 'yes' });
    expect(Object.keys(headers).filter((name) => name.startsWith(':'))).toEqual([]);
  });

  it('keeps a host header that the client sent', async () => {
    const session = await connect(app());

    const reply = await send(session, { ':method': 'GET', ':path': '/', host: 'other.localhost' });

    expect(JSON.parse(reply.body.toString()).headers.host).toBe('other.localhost');
  });

  it('drops the headers that only HTTP/1 has, instead of throwing', async () => {
    const created = createHttp2App();
    created.use((request, response) => {
      response.setHeader('Keep-Alive', 'timeout=5');
      response.writeHead(101, { Upgrade: 'websocket', Connection: 'Upgrade', 'Transfer-Encoding': 'chunked', 'X-Kept': 'yes' });
      response.end();
    });
    const session = await connect(created);

    const reply = await send(session, { ':method': 'GET', ':path': '/' });

    expect(reply.headers['x-kept']).toBe('yes');
    expect(Object.keys(reply.headers)).not.toEqual(expect.arrayContaining(['upgrade']));
    expect(Object.keys(reply.headers)).not.toEqual(expect.arrayContaining(['keep-alive']));
  });

  it('compresses the responses with the compression middleware', async () => {
    const created = createHttp2App();
    const text = 'It works! '.repeat(500);
    created.use(compressionMiddleware({}));
    created.use((request, response) => {
      response.type('text/plain');
      response.write(text.slice(0, 2000));
      response.end(text.slice(2000));
    });
    const session = await connect(created);

    const reply = await send(session, { ':method': 'GET', ':path': '/', 'accept-encoding': 'gzip' });

    expect(reply.headers['content-encoding']).toBe('gzip');
    expect(zlib.gunzipSync(reply.body).toString()).toBe(text);
  });
});
