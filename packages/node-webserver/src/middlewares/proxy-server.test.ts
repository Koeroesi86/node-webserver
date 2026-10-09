import express from 'express';
import http from 'http';
import https from 'https';
import net from 'net';
import { once } from 'events';
import proxyServerMiddleware from './proxy-server';
import type { ProxyOptions, ServerInstance } from '../types';

jest.mock('../utils/logger', () => ({ __esModule: true, default: { system: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() } }));

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
}

interface Received {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const token = 'secret-token';
const controlPath = '/.well-known/node-webserver/proxy';
const servers: net.Server[] = [];

const listen = async <T extends net.Server>(server: T) => {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();

  return { server, port: address && typeof address === 'object' ? address.port : 0 };
};

/** a target that answers with what it received, and the requests it received */
const startUpstream = async (handler?: http.RequestListener) => {
  const received: Received[] = [];
  const server = http.createServer(
    handler ??
      ((request, response) => {
        const parts: Buffer[] = [];
        request.on('data', (part: Buffer) => parts.push(part));
        request.on('end', () => {
          received.push({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(parts).toString('utf8') });
          response.writeHead(201, { 'Content-Type': 'text/plain', Server: 'provider', 'X-Kept': 'yes', 'Set-Cookie': ['a=1', 'b=2'] });
          response.end('from upstream');
        });
      })
  );
  const { port } = await listen(server);

  return { server, port, received };
};

/** the proxy server of one host, with the loopback address trusted as a load balancer when asked */
const startProxy = async (proxyOptions: ProxyOptions, { trustLoopback = false, hostname = 'app.localhost' } = {}) => {
  const app = express();
  app.set('trust proxy', trustLoopback ? ['loopback'] : []);
  const instance: ServerInstance = { hostname, protocol: 'https', type: 'proxy', proxyOptions };
  app.use(proxyServerMiddleware(instance));
  const { port } = await listen(http.createServer(app));

  return port;
};

const request = (port: number, path = '/', { method = 'GET', headers = {} as http.OutgoingHttpHeaders, body = '' } = {}) =>
  new Promise<Reply>((resolve, reject) => {
    const outgoing = http.request({ host: '127.0.0.1', port, path, method, headers: { Host: 'app.localhost', ...headers }, agent: false }, (response) => {
      const parts: Buffer[] = [];
      response.on('data', (part: Buffer) => parts.push(part));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, text: Buffer.concat(parts).toString('utf8') }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });

/** a request to the control path, as a trusted load balancer that ended TLS sends it */
const control = (port: number, method: string, body?: object, headers: http.OutgoingHttpHeaders = {}) =>
  request(port, controlPath, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : '',
  });

const closedPort = async () => {
  const { server, port } = await listen(net.createServer());
  await new Promise((resolve) => server.close(resolve));

  return port;
};

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map((server) => {
      if (server instanceof http.Server) server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    })
  );
});

describe('proxyServerMiddleware', () => {
  it.each([
    ['neither a target nor a dynamic one', {}],
    ['both a target and a dynamic one', { target: 'http://127.0.0.1:1', dynamic: { token } }],
  ])('refuses %s', (_, proxyOptions) => {
    expect(() => proxyServerMiddleware({ hostname: 'app.localhost', protocol: 'https', type: 'proxy', proxyOptions })).toThrow('needs either a target');
  });

  it('needs a token for a dynamic target', () => {
    expect(() =>
      proxyServerMiddleware({ hostname: 'app.localhost', protocol: 'https', type: 'proxy', proxyOptions: { dynamic: { tokenEnv: 'NOT_SET_ANYWHERE' } } })
    ).toThrow('needs a token');
  });

  describe('with a fixed target', () => {
    it('passes the request on and the answer back, with the host the client asked for', async () => {
      const upstream = await startUpstream();
      const port = await startProxy({ target: `http://127.0.0.1:${upstream.port}` });

      const reply = await request(port, '/path?a=1', { method: 'POST', body: 'hello', headers: { 'X-Custom': 'kept' } });

      expect(reply).toMatchObject({ status: 201, text: 'from upstream', headers: { 'x-kept': 'yes', server: 'provider', 'set-cookie': ['a=1', 'b=2'] } });
      expect(upstream.received).toEqual([
        expect.objectContaining({
          method: 'POST',
          url: '/path?a=1',
          body: 'hello',
          headers: expect.objectContaining({ host: 'app.localhost', 'x-custom': 'kept' }),
        }),
      ]);
    });

    it('sends the host of the target with changeOrigin, below the path of the target, and hides the headers it is told to', async () => {
      const upstream = await startUpstream();
      const port = await startProxy({ target: `http://127.0.0.1:${upstream.port}/base/`, changeOrigin: true, hideHeaders: ['Server', 'x-powered-by'] });

      const reply = await request(port, '/path');

      expect(reply.headers.server).toBeUndefined();
      expect(reply.headers['x-kept']).toBe('yes');
      expect(upstream.received[0]).toMatchObject({ url: '/base/path', headers: { host: `127.0.0.1:${upstream.port}` } });
    });

    it('answers 502 when the target cannot be reached', async () => {
      const port = await startProxy({ target: `http://127.0.0.1:${await closedPort()}` });

      expect((await request(port)).status).toBe(502);
    });

    it('answers 504 when the target does not answer in time', async () => {
      const upstream = await startUpstream(() => undefined);
      const port = await startProxy({ target: `http://127.0.0.1:${upstream.port}`, proxyTimeout: 50 });

      expect((await request(port)).status).toBe(504);
    });

    it('aborts the request to the target when the client goes away', async () => {
      let arrived: (request: http.IncomingMessage) => void = () => undefined;
      const upstreamRequest = new Promise<http.IncomingMessage>((resolve) => (arrived = resolve));
      const upstream = await startUpstream((incoming) => arrived(incoming));
      const port = await startProxy({ target: `http://127.0.0.1:${upstream.port}` });
      const client = http.request({ host: '127.0.0.1', port, headers: { Host: 'app.localhost' }, agent: false });
      client.on('error', () => undefined);
      client.end();

      const incoming = await upstreamRequest;
      // the target sees the request aborted
      const aborted = new Promise<Error>((resolve) => incoming.on('error', resolve));
      client.destroy();

      expect((await aborted).message).toBe('aborted');
    });

    it('connects a websocket to the target', async () => {
      const upstream = await startUpstream();
      upstream.server.on('upgrade', (incoming: http.IncomingMessage, socket: net.Socket) => {
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Path: ${incoming.url}\r\n\r\n`);
        socket.pipe(socket);
      });
      const port = await startProxy({ target: `http://127.0.0.1:${upstream.port}` });
      const client = net.connect(port, '127.0.0.1');
      let received = '';
      const echoed = new Promise<void>((resolve) =>
        client.on('data', (data: Buffer) => {
          received += data.toString('utf8');
          if (received.includes('\r\n\r\n') && !received.endsWith('ping')) client.write('ping');
          if (received.endsWith('ping')) resolve();
        })
      );
      client.write('GET /socket HTTP/1.1\r\nHost: app.localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');

      await echoed;
      client.destroy();
      expect(received).toMatch(/^HTTP\/1.1 101 Switching Protocols\r\n/);
      expect(received.toLowerCase()).toContain('x-path: /socket');
    });

    it('names the target, not the client, in the TLS handshake with an https target', async () => {
      let serverName: string | undefined;
      const upstream = https.createServer({
        SNICallback: (name, callback) => {
          serverName = name;
          callback(new Error('no certificate in this test'));
        },
      });
      const { port: upstreamPort } = await listen(upstream);
      const port = await startProxy({ target: `https://localhost:${upstreamPort}` });

      expect((await request(port)).status).toBe(502);
      expect(serverName).toBe('localhost');
    });
  });

  describe('forwarding headers', () => {
    const forwarded = async (proxyOptions: Partial<ProxyOptions>, headers: http.OutgoingHttpHeaders, trustLoopback = false) => {
      const upstream = await startUpstream();
      const port = await startProxy({ target: `http://127.0.0.1:${upstream.port}`, ...proxyOptions }, { trustLoopback });
      await request(port, '/', { headers });

      return upstream.received[0].headers;
    };
    const spoofed = { 'X-Forwarded-For': '1.2.3.4', 'X-Forwarded-Proto': 'https', 'X-Real-IP': '1.2.3.4', 'X-Client-IP': '1.2.3.4' };

    it('replaces what a direct client says about itself with the connection', async () => {
      const headers = await forwarded({}, spoofed);

      expect(headers).toMatchObject({ 'x-forwarded-for': '127.0.0.1', 'x-forwarded-proto': 'http', 'x-forwarded-host': 'app.localhost' });
      expect(headers['x-real-ip']).toBeUndefined();
      expect(headers['x-client-ip']).toBeUndefined();
    });

    it('appends the peer to the chain of a trusted load balancer and keeps what it says', async () => {
      const headers = await forwarded({}, { 'X-Forwarded-For': '1.2.3.4, 10.0.0.1', 'X-Forwarded-Proto': 'https', 'X-Real-IP': '1.2.3.4' }, true);

      expect(headers).toMatchObject({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 127.0.0.1', 'x-forwarded-proto': 'https', 'x-real-ip': '1.2.3.4' });
    });

    it('passes the headers of the client untouched when told to', async () => {
      const headers = await forwarded({ forwardedHeaders: 'pass' }, spoofed);

      expect(headers).toMatchObject({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '1.2.3.4' });
    });

    it('sends none when told to', async () => {
      const headers = await forwarded({ forwardedHeaders: 'none' }, spoofed, true);

      expect(Object.keys(headers).filter((name) => name.startsWith('x-'))).toEqual([]);
    });
  });

  describe('with a dynamic target', () => {
    it('answers 503 until a target is set', async () => {
      const port = await startProxy({ dynamic: { token } });

      expect((await request(port)).status).toBe(503);
    });

    it('takes the address of the caller with the port of the body, and passes requests on to it, but never the control path', async () => {
      const upstream = await startUpstream();
      const port = await startProxy({ dynamic: { token, allowPrivate: true } }, { trustLoopback: true });

      const set = await control(port, 'PUT', { port: upstream.port });
      const reply = await request(port, '/after');
      const shown = await control(port, 'GET');
      await request(port, controlPath);

      expect(set.status).toBe(200);
      expect(JSON.parse(set.text)).toMatchObject({ target: `http://127.0.0.1:${upstream.port}/` });
      expect(reply.status).toBe(201);
      expect(JSON.parse(shown.text)).toMatchObject({ target: `http://127.0.0.1:${upstream.port}/`, setAt: expect.any(String) });
      expect(upstream.received.map(({ url }) => url)).toEqual(['/after']);
    });

    it('takes the client from the chain of a trusted load balancer, from the right', async () => {
      const port = await startProxy({ dynamic: { token, port: 8080 } }, { trustLoopback: true });

      const set = await control(port, 'PUT', {}, { 'X-Forwarded-For': '6.6.6.6, 203.0.113.7' });

      expect(JSON.parse(set.text)).toMatchObject({ target: 'http://203.0.113.7:8080/' });
    });

    it('removes the target', async () => {
      const port = await startProxy({ dynamic: { token } }, { trustLoopback: true });
      await control(port, 'PUT', { target: 'http://203.0.113.7:8080' });

      expect((await control(port, 'DELETE')).status).toBe(204);
      expect((await control(port, 'GET')).status).toBe(404);
      expect((await request(port)).status).toBe(503);
    });

    it('expires a target that is not set again within its ttl', async () => {
      const upstream = await startUpstream();
      const port = await startProxy({ dynamic: { token, ttl: 60, allowPrivate: true } }, { trustLoopback: true });
      await control(port, 'PUT', { port: upstream.port });
      const now = Date.now();

      expect((await request(port)).status).toBe(201);
      jest.spyOn(Date, 'now').mockReturnValue(now + 61000);
      expect((await request(port)).status).toBe(503);
    });

    it.each([
      ['without a token', { Authorization: '' }, 401],
      ['with the wrong token', { Authorization: 'Bearer wrong' }, 401],
      ['with the token in another scheme', { Authorization: `Basic ${token}` }, 401],
      ['over plain http', { 'X-Forwarded-Proto': 'http' }, 403],
    ])('refuses an update %s', async (_, headers, status) => {
      const port = await startProxy({ dynamic: { token } }, { trustLoopback: true });

      expect((await control(port, 'PUT', { target: 'http://203.0.113.7' }, headers)).status).toBe(status);
      expect((await control(port, 'GET')).status).toBe(404);
    });

    it('does not believe a client that says it came over https', async () => {
      const port = await startProxy({ dynamic: { token } });

      expect((await control(port, 'PUT', { target: 'http://203.0.113.7' })).status).toBe(403);
    });

    it('takes only its own token', async () => {
      const port = await startProxy({ dynamic: { token: 'token-of-another-host' } }, { trustLoopback: true });

      expect((await control(port, 'PUT', { target: 'http://203.0.113.7' })).status).toBe(401);
    });

    it.each([
      ['a private address', { target: 'http://10.0.0.1' }, 403],
      ['the metadata service', { target: 'http://169.254.169.254' }, 403],
      ['the loopback address of the caller', { port: 8080 }, 403],
      ['a name', { target: 'http://example.com' }, 400],
      ['another protocol', { target: 'ftp://203.0.113.7' }, 400],
      ['no port', {}, 400],
    ])('refuses %s as a target', async (_, body, status) => {
      const port = await startProxy({ dynamic: { token } }, { trustLoopback: true });

      expect((await control(port, 'PUT', body)).status).toBe(status);
    });

    it('refuses an address that failed too often, even with the right token', async () => {
      const port = await startProxy({ dynamic: { token } }, { trustLoopback: true });
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await control(port, 'GET', undefined, { Authorization: 'Bearer wrong' });
      }

      expect((await control(port, 'GET')).status).toBe(429);
    });

    it('answers only GET, PUT and DELETE', async () => {
      const port = await startProxy({ dynamic: { token } }, { trustLoopback: true });
      const reply = await control(port, 'POST');

      expect(reply.status).toBe(405);
      expect(reply.headers.allow).toBe('GET, PUT, DELETE');
    });
  });
});
