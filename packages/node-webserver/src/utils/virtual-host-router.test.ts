import express from 'express';
import http from 'http';
import vHost from 'vhost';
import virtualHostRouter from './virtual-host-router';
import type { AddressInfo } from 'net';
import type { Express, RequestHandler } from 'express';
import type { VirtualHost } from '../types/virtual-host';

describe('virtualHostRouter', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => {
        server.closeAllConnections();
        return new Promise((resolve) => server.close(resolve));
      })
    );
  });

  /** a host that answers with its name, or passes the request on after writing its name to a header */
  const host = (hostname: string, passes = false): VirtualHost => ({
    hostname,
    handler: (request, response, next) => {
      const calls = `${response.getHeader('x-calls') ?? ''}${hostname},`;
      if (passes) {
        response.setHeader('x-calls', calls);
        next();
        return;
      }
      response.end(calls);
    },
  });

  const withFallback = (app: Express) => app.use((request, response) => response.status(404).end(`${response.getHeader('x-calls') ?? ''}fallback`));

  /** the routing the server had before: a vhost middleware for every host, in the order of the configuration */
  const vHostApp = (hosts: VirtualHost[]) => withFallback(hosts.reduce((app, { hostname, handler }) => app.use(vHost(hostname, handler)), express()));
  const routerApp = (hosts: VirtualHost[]) => withFallback(express().use(virtualHostRouter(hosts)));

  const get = async (app: Express, hostHeader: string) => {
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    return new Promise<string>((resolve, reject) => {
      http
        .get({ port, setHost: false, headers: { Host: hostHeader } }, (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks).toString()));
        })
        .on('error', reject);
    });
  };

  it('finds a host by its name', async () => {
    const app = routerApp([host('a.localhost'), host('b.localhost'), host('c.localhost')]);

    expect(await get(app, 'b.localhost')).toBe('b.localhost,');
  });

  it('ignores the port and the case of the host header', async () => {
    const app = routerApp([host('Web.Localhost')]);

    expect(await get(app, 'WEB.localhost:8080')).toBe('Web.Localhost,');
  });

  it('passes a request for an unknown host on', async () => {
    expect(await get(routerApp([host('a.localhost')]), 'other.localhost')).toBe('fallback');
  });

  it('runs the hosts that match in the order of the configuration, exact and wildcard alike', async () => {
    const app = routerApp([host('*.localhost', true), host('a.localhost', true), host('*.localhost', true), host('a.localhost')]);

    expect(await get(app, 'a.localhost')).toBe('*.localhost,a.localhost,*.localhost,a.localhost,');
  });

  it('passes an error of a host on without running the next one', async () => {
    const failing: RequestHandler = (request, response, next) => next(new Error('failed'));
    const app = express()
      .use(virtualHostRouter([{ hostname: 'a.localhost', handler: failing }, host('a.localhost')]))
      .use((error: Error, request: express.Request, response: express.Response, next: express.NextFunction) => response.status(500).end(error.message));

    expect(await get(app, 'a.localhost')).toBe('failed');
  });

  describe('matches the same hosts as one vhost middleware per host did', () => {
    const configurations: Record<string, VirtualHost[]> = {
      'exact hosts': [host('a.localhost'), host('b.localhost')],
      'a wildcard before an exact host': [host('*.localhost'), host('a.localhost')],
      'an exact host before a wildcard': [host('a.localhost'), host('*.localhost')],
      'hosts that pass the request on': [host('*.localhost', true), host('a.localhost', true), host('*.*.localhost', true), host('a.b.localhost')],
      'the same host twice': [host('a.localhost', true), host('a.localhost')],
      'characters that mean something in a pattern': [host('a+b.localhost'), host('a.b.localhost'), host('[::1]')],
    };
    const requests = [
      'a.localhost',
      'A.LOCALHOST:80',
      'b.localhost',
      'a.b.localhost',
      'ab.localhost',
      'a+b.localhost',
      'aab.localhost',
      'localhost',
      '[::1]:80',
      'x.a.localhost',
    ];

    it.each(Object.keys(configurations))('%s', async (name) => {
      const hosts = configurations[name];
      const answers = (app: Express) => Promise.all(requests.map((request) => get(app, request)));

      expect(await answers(routerApp(hosts))).toEqual(await answers(vHostApp(hosts)));
    });
  });
});
