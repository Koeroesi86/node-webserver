import express from 'express';
import http from 'http';
import zlib from 'zlib';
import { middleware } from '@koeroesi86/node-worker-express';
import createInstanceHandler from './create-instance-handler';
import setupVirtualHosts from './setupVirtualHosts';
import type { Express, RequestHandler } from 'express';
import type { ServerInstance } from '../types';

const text = 'It works! '.repeat(500);

// the worker middleware starts processes, a handler that answers is enough here
jest.mock('@koeroesi86/node-worker-express', () => ({
  middleware: jest.fn(() => (request: http.IncomingMessage, response: http.ServerResponse) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(text);
  }),
}));
jest.mock('./logger', () => ({ __esModule: true, default: { system: jest.fn(), error: jest.fn(), info: jest.fn() } }));

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

  const instance = (overrides: Partial<ServerInstance>): ServerInstance => ({
    hostname: 'web.localhost',
    protocol: 'http',
    type: 'worker',
    options: { root: '/' },
    ...overrides,
  });

  const ports = { portHttp: 80, portHttps: 443 };

  /** the apps of the two ports, with the servers on them */
  const setup = (instances: ServerInstance[]) => {
    const hosts = setupVirtualHosts(
      instances.map((current) => ({ instance: current, ...createInstanceHandler(current) })),
      ports
    );
    const httpApp = express();
    const httpsApp = express();
    httpApp.use(hosts.http);
    httpsApp.use(hosts.https);

    return { httpApp, httpsApp };
  };

  const get = async (app: Express, hostname: string, acceptEncoding?: string) => {
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      http
        .get(
          { port: (server.address() as { port: number }).port, headers: { Host: hostname, ...(acceptEncoding && { 'Accept-Encoding': acceptEncoding }) } },
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

    expect((await get(httpsApp, 'web.localhost')).status).toBe(404);
  });

  it('puts an https server on the app of the https port, with its compression', async () => {
    const { httpApp, httpsApp } = setup([instance({ protocol: 'https', compression: true })]);

    expect((await get(httpsApp, 'web.localhost', 'gzip')).headers['content-encoding']).toBe('gzip');
    expect((await get(httpApp, 'web.localhost')).status).toBe(404);
  });

  it('passes a request on to the server of its host name, past the servers of other host names', async () => {
    const answer =
      (text: string): RequestHandler =>
      (request, response) =>
        response.end(text);
    const hosts = setupVirtualHosts(
      [
        { instance: instance({ hostname: 'a.localhost' }), handler: answer('a') },
        { instance: instance({ hostname: 'b.localhost' }), handler: answer('b') },
      ],
      ports
    );
    const httpApp = express();
    httpApp.use(hosts.http);

    expect((await get(httpApp, 'b.localhost')).body.toString()).toBe('b');
    expect((await get(httpApp, 'a.localhost')).body.toString()).toBe('a');
  });

  it('gives the servers their address', () => {
    const http = instance({ hostname: 'a.localhost' });
    const https = instance({ hostname: 'b.localhost', protocol: 'https' });

    setupVirtualHosts(
      [http, https].map((current) => ({ instance: current, handler: jest.fn() })),
      { portHttp: 8080, portHttps: 443 }
    );

    expect([http.url, https.url]).toEqual(['http://a.localhost:8080', 'https://b.localhost']);
  });

  it('names the worker pool of a server after its host name, for the metrics', () => {
    setup([instance({ hostname: 'named.localhost' })]);

    expect(middleware).toHaveBeenCalledWith(expect.objectContaining({ name: 'named.localhost' }));
  });

  it('lets the options of a server name the pool themselves', () => {
    setup([instance({ hostname: 'named.localhost', options: { root: '/', name: 'own-name' } })]);

    expect(middleware).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'own-name' }));
  });
});
