import express from 'express';
import http from 'http';
import zlib from 'zlib';
import { middleware } from '@koeroesi86/node-worker-express';
import setupVirtualHosts from './setupVirtualHosts';
import type { Express } from 'express';
import type { WorkerBudget } from '@koeroesi86/node-worker-express';
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
    const httpApp = express();
    setupVirtualHosts([instance({ compression: true })], httpApp, express(), { portHttp: 80, portHttps: 443 });

    const response = await get(httpApp, 'web.localhost', 'gzip');

    expect(response.headers['content-encoding']).toBe('gzip');
    expect(zlib.gunzipSync(response.body).toString()).toBe(text);
  });

  it('does not compress by default', async () => {
    const httpApp = express();
    setupVirtualHosts([instance({})], httpApp, express(), { portHttp: 80, portHttps: 443 });

    const response = await get(httpApp, 'web.localhost', 'gzip');

    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.body.toString()).toBe(text);
  });

  it('passes the options of the compression on', async () => {
    const httpApp = express();
    setupVirtualHosts([instance({ compression: { encodings: ['deflate'] } })], httpApp, express(), { portHttp: 80, portHttps: 443 });

    expect((await get(httpApp, 'web.localhost', 'gzip, deflate')).headers['content-encoding']).toBe('deflate');
  });

  it('compresses only the servers that asked for it', async () => {
    const httpApp = express();
    setupVirtualHosts([instance({ hostname: 'plain.localhost' }), instance({ hostname: 'small.localhost', compression: true })], httpApp, express(), {
      portHttp: 80,
      portHttps: 443,
    });

    expect((await get(httpApp, 'plain.localhost', 'gzip')).headers['content-encoding']).toBeUndefined();
    expect((await get(httpApp, 'small.localhost', 'gzip')).headers['content-encoding']).toBe('gzip');
  });

  it('keeps an http server off the app of the https port', () => {
    const httpsApp = express();
    const use = jest.spyOn(httpsApp, 'use');

    setupVirtualHosts([instance({})], express(), httpsApp, { portHttp: 80, portHttps: 443 });

    expect(use).not.toHaveBeenCalled();
  });

  it('puts an https server on the app of the https port, with its compression', () => {
    const httpsApp = express();
    const use = jest.spyOn(httpsApp, 'use');

    setupVirtualHosts([instance({ protocol: 'https', compression: true })], express(), httpsApp, { portHttp: 80, portHttps: 443 });

    expect(use).toHaveBeenCalledTimes(1);
  });

  it('names the worker pool of a server after its host name, for the metrics', () => {
    setupVirtualHosts([instance({ hostname: 'named.localhost' })], express(), express(), { portHttp: 80, portHttps: 443 });

    expect(middleware).toHaveBeenCalledWith(expect.objectContaining({ name: 'named.localhost' }));
  });

  it('lets the options of a server name the pool themselves', () => {
    setupVirtualHosts([instance({ hostname: 'named.localhost', options: { root: '/', name: 'own-name' } })], express(), express(), {
      portHttp: 80,
      portHttps: 443,
    });

    expect(middleware).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'own-name' }));
  });

  it('hands every worker server the same budget, so that their workers count together', () => {
    const workerBudget: WorkerBudget = { limit: 2, join: jest.fn(), hasRoom: jest.fn(), findIdleWorker: jest.fn(), wakeUp: jest.fn(), getStats: jest.fn() };
    jest.mocked(middleware).mockClear();

    setupVirtualHosts(
      [instance({ hostname: 'one.localhost' }), instance({ hostname: 'two.localhost' })],
      express(),
      express(),
      { portHttp: 80, portHttps: 443 },
      workerBudget
    );

    expect(jest.mocked(middleware).mock.calls.map(([options]) => options.workerBudget)).toEqual([workerBudget, workerBudget]);
  });
});
