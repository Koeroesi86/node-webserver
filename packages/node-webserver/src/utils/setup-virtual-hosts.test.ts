import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { middleware } from '@koeroesi86/node-worker-express';
import { createInstanceHandler } from '../server';
import setupVirtualHosts from './setup-virtual-hosts';
import createMockLogger from './mock-logger.test-helper';
import type { Express, RequestHandler } from 'express';
import type { ServerConfig, ServerRuntime } from '../types';

const text = 'It works! '.repeat(500);

// the worker middleware starts processes, a handler that answers is enough here
jest.mock('@koeroesi86/node-worker-express', () => ({
  ...jest.requireActual('@koeroesi86/node-worker-express'),
  middleware: jest.fn(() => (request: http.IncomingMessage, response: http.ServerResponse) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(text);
  }),
}));

describe('setupVirtualHosts', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => {
        server.closeAllConnections();
        return new Promise((resolve) => server.close(resolve));
      })
    );
  });

  const instance = (overrides: Partial<ServerConfig>): ServerConfig => ({
    hostname: 'web.localhost',
    protocol: 'http',
    type: 'worker',
    options: { root: '/' },
    ...overrides,
  });

  const ports = { portHttp: 80, portHttps: 443 };

  /** the apps of the two ports, with the servers on them */
  const setup = (instances: ServerConfig[]) => {
    const hosts = setupVirtualHosts(
      instances.map((current) => {
        const runtime = {};
        return { instance: current, runtime, ...createInstanceHandler(current, runtime, { logger: createMockLogger() }) };
      }),
      ports,
      createMockLogger()
    );
    const httpApp = express();
    const httpsApp = express();
    httpApp.use(hosts.http);
    httpsApp.use(hosts.https);

    return { httpApp, httpsApp };
  };

  const get = async (app: Express, hostname: string, acceptEncoding?: string, path = '/') => {
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      http
        .get(
          {
            port: (server.address() as { port: number }).port,
            path,
            headers: { Host: hostname, ...(acceptEncoding && { 'Accept-Encoding': acceptEncoding }) },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
          }
        )
        .on('error', reject);
    });
  };

  it('compresses the answers of a server that asked for it', async () => {
    const { httpApp } = setup([instance({ compression: true })]);

    const response = await get(httpApp, 'web.localhost', 'gzip');

    expect(response.headers['content-encoding']).toBe('gzip');
    expect(zlib.gunzipSync(response.body).toString()).toBe(text);
  });

  it('does not compress by default', async () => {
    const { httpApp } = setup([instance({})]);

    const response = await get(httpApp, 'web.localhost', 'gzip');

    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.body.toString()).toBe(text);
  });

  it('passes the options of the compression on', async () => {
    const { httpApp } = setup([instance({ compression: { encodings: ['deflate'] } })]);

    expect((await get(httpApp, 'web.localhost', 'gzip, deflate')).headers['content-encoding']).toBe('deflate');
  });

  it('compresses only the servers that asked for it', async () => {
    const { httpApp } = setup([instance({ hostname: 'plain.localhost' }), instance({ hostname: 'small.localhost', compression: true })]);

    expect((await get(httpApp, 'plain.localhost', 'gzip')).headers['content-encoding']).toBeUndefined();
    expect((await get(httpApp, 'small.localhost', 'gzip')).headers['content-encoding']).toBe('gzip');
  });

  it('keeps an http server off the app of the https port', async () => {
    const { httpsApp } = setup([instance({})]);

    expect((await get(httpsApp, 'web.localhost')).status).toBe(421);
  });

  it('puts an https server on the app of the https port, with its compression', async () => {
    const { httpApp, httpsApp } = setup([instance({ protocol: 'https', compression: true })]);

    expect((await get(httpsApp, 'web.localhost', 'gzip')).headers['content-encoding']).toBe('gzip');
    expect((await get(httpApp, 'web.localhost')).status).toBe(421);
  });

  it('passes a request on to the server of its host name, past the servers of other host names', async () => {
    const answer =
      (text: string): RequestHandler =>
      (request, response) =>
        response.end(text);
    const hosts = setupVirtualHosts(
      [
        { instance: instance({ hostname: 'a.localhost' }), runtime: {}, handler: answer('a') },
        { instance: instance({ hostname: 'b.localhost' }), runtime: {}, handler: answer('b') },
      ],
      ports,
      createMockLogger()
    );
    const httpApp = express();
    httpApp.use(hosts.http);

    expect((await get(httpApp, 'b.localhost')).body.toString()).toBe('b');
    expect((await get(httpApp, 'a.localhost')).body.toString()).toBe('a');
  });

  it('gives the servers their address', () => {
    const http = instance({ hostname: 'a.localhost' });
    const https = instance({ hostname: 'b.localhost', protocol: 'https' });

    const runtimes = [{}, {}] as Array<ServerRuntime>;
    setupVirtualHosts(
      [http, https].map((current, index) => ({ instance: current, runtime: runtimes[index], handler: jest.fn() })),
      { portHttp: 8080, portHttps: 443 },
      createMockLogger()
    );

    expect(runtimes.map(({ url }) => url)).toEqual(['http://a.localhost:8080', 'https://b.localhost']);
  });

  it('names the worker pool of a server after its host name, for the metrics', () => {
    setup([instance({ hostname: 'named.localhost' })]);

    expect(middleware).toHaveBeenCalledWith(expect.objectContaining({ name: 'named.localhost' }));
  });

  it('lets the options of a server name the pool themselves', () => {
    setup([instance({ hostname: 'named.localhost', options: { root: '/', name: 'own-name' } })]);

    expect(middleware).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'own-name' }));
  });

  describe('redirect to https', () => {
    const secure = (overrides: Partial<ServerConfig> = {}) => instance({ protocol: 'https', redirectHttp: true, ...overrides });

    it('redirects the http requests of an https server that asked for it', async () => {
      const { httpApp } = setup([secure()]);

      const response = await get(httpApp, 'web.localhost');

      expect(response.status).toBe(308);
      expect(response.headers.location).toBe('https://web.localhost/');
    });

    it('leaves the http requests of the others alone', async () => {
      const { httpApp } = setup([secure({ redirectHttp: undefined })]);

      expect((await get(httpApp, 'web.localhost')).status).toBe(421);
    });

    it('redirects every name a wildcard matches, on the name that was asked for', async () => {
      const { httpApp } = setup([secure({ hostname: '*.example.com' })]);

      expect((await get(httpApp, 'a.example.com')).headers.location).toBe('https://a.example.com/');
    });

    it('lets an http server of the same name answer first', async () => {
      const { httpApp } = setup([secure(), instance({})]);

      expect((await get(httpApp, 'web.localhost')).status).toBe(200);
    });

    it('does not redirect the requests that come to https', async () => {
      const { httpsApp } = setup([secure()]);

      expect((await get(httpsApp, 'web.localhost')).status).toBe(200);
    });
  });

  describe('rules', () => {
    it('redirect before the server of the host answers, with HSTS on an https server', async () => {
      const { httpsApp } = setup([instance({ protocol: 'https', hsts: true, rules: [{ path: '/old', redirect: '/new', status: 301 }] })]);

      const response = await get(httpsApp, 'web.localhost', undefined, '/old');

      expect(response.status).toBe(301);
      expect(response.headers.location).toBe('/new');
      expect(response.headers['strict-transport-security']).toBeDefined();
    });

    it('leave the requests no rule matches to the server, and the other hosts alone', async () => {
      const { httpApp } = setup([instance({ rules: [{ path: '/old', redirect: '/new', status: 301 }] }), instance({ hostname: 'plain.localhost' })]);

      expect((await get(httpApp, 'web.localhost', undefined, '/other')).status).toBe(200);
      expect((await get(httpApp, 'plain.localhost', undefined, '/old')).status).toBe(200);
    });
  });

  describe('default host', () => {
    it('answers the requests of a host name that no server has', async () => {
      const { httpApp } = setup([instance({ hostname: 'other.localhost' }), instance({ defaultHost: true })]);

      expect((await get(httpApp, 'unknown.localhost')).status).toBe(200);
    });

    it('answers nothing for the others without one', async () => {
      const { httpApp } = setup([instance({})]);

      expect((await get(httpApp, 'unknown.localhost')).status).toBe(421);
    });

    it('answers the others with the page of unknownHostPage, with 421', async () => {
      const page = path.join(os.tmpdir(), `unknown-${process.pid}.html`);
      fs.writeFileSync(page, '<p>no such site</p>');
      const app = express().use(setupVirtualHosts([], { ...ports, unknownHostPage: page }, createMockLogger()).http);
      const reply = await get(app, 'unknown.localhost');
      fs.rmSync(page);

      expect(reply.status).toBe(421);
      expect(reply.body.toString()).toBe('<p>no such site</p>');
      expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
    });

    it('is per protocol', async () => {
      const { httpApp, httpsApp } = setup([instance({ protocol: 'https', defaultHost: true })]);

      expect((await get(httpsApp, 'unknown.localhost')).status).toBe(200);
      expect((await get(httpApp, 'unknown.localhost')).status).toBe(421);
    });

    it('comes after the redirect to https of the servers that asked for it', async () => {
      const { httpApp } = setup([instance({ defaultHost: true }), instance({ hostname: 'secure.localhost', protocol: 'https', redirectHttp: true })]);

      expect((await get(httpApp, 'secure.localhost')).status).toBe(308);
      expect((await get(httpApp, 'unknown.localhost')).status).toBe(200);
    });
  });

  describe('hsts', () => {
    it('sets the header on the responses of an https server that asked for it', async () => {
      const { httpsApp } = setup([instance({ protocol: 'https', hsts: { maxAge: 60 } })]);

      expect((await get(httpsApp, 'web.localhost')).headers['strict-transport-security']).toBe('max-age=60');
    });

    it('sets nothing by default, or on an http server', async () => {
      const { httpApp, httpsApp } = setup([instance({ hostname: 'plain.localhost', protocol: 'https' }), instance({ hsts: true })]);

      expect((await get(httpsApp, 'plain.localhost')).headers['strict-transport-security']).toBeUndefined();
      expect((await get(httpApp, 'web.localhost')).headers['strict-transport-security']).toBeUndefined();
    });
  });
});
