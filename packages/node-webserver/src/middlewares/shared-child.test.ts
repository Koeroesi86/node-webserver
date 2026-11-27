import express from 'express';
import http from 'http';
import type net from 'net';
import sharedChildMiddleware from './shared-child';
import createMockLogger from '../observability/mock-logger.test-helper';
import type { ServerConfig } from '../types';

describe('sharedChildMiddleware', () => {
  const logger = createMockLogger();
  let application: http.Server;
  let port: number;
  const servers: http.Server[] = [];

  const listen = async (server: http.Server) => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    servers.push(server);
    return (server.address() as net.AddressInfo).port;
  };

  beforeAll(async () => {
    application = http.createServer((_, response) => response.end('application'));
    port = await listen(application);
  });

  afterAll(() =>
    servers.forEach((server) => {
      server.closeAllConnections();
      server.close();
    })
  );

  const instance = (extra: Partial<ServerConfig> = {}): ServerConfig => ({
    hostname: 'child.localhost',
    protocol: 'http',
    type: 'child',
    childOptions: { command: 'node', args: ['app.js', '--port=%PORT%'] },
    proxyOptions: {},
    serverOptions: { protocol: 'http' },
    ...extra,
  });

  const create = (server: ServerConfig) => {
    let tell: (value: number) => void = () => {};
    let refuse: (error: Error) => void = () => {};
    const claimed = new Promise<number>((resolve, reject) => {
      tell = resolve;
      refuse = reject;
    });
    const apps = { claim: jest.fn(() => claimed), start: jest.fn(), release: jest.fn(), pid: jest.fn(() => 4321) };
    const child = sharedChildMiddleware(server, { apps, logger, fingerprint: 'one', portLookup: { from: 1, to: 2, address: 'localhost' } });
    return { apps, child, tell, refuse };
  };

  const get = async (handler: express.RequestHandler) => {
    const front = await listen(http.createServer(express().use(handler)));
    return fetch(`http://localhost:${front}/`);
  };

  it('has the application started on the port the primary picked, and passes the requests on to it, also the ones that came before', async () => {
    const { apps, child, tell } = create(instance());
    const early = get(child.handler);

    tell(port);

    expect(await (await early).text()).toBe('application');
    expect(apps.claim).toHaveBeenCalledWith(expect.stringContaining('http child.localhost '), {
      port: undefined,
      lookup: { from: 1, to: 2, address: 'localhost' },
    });
    expect(apps.start).toHaveBeenCalledWith(expect.any(String), 'child.localhost', 'node', ['app.js', `--port=${port}`]);
    expect(await (await get(child.handler)).text()).toBe('application');
  });

  it('tells the process of the application that the primary runs', () => {
    const { apps, child } = create(instance());

    expect(child.pid()).toBe(4321);
    expect(apps.pid).toHaveBeenCalledWith(expect.stringContaining('http child.localhost '));
  });

  it('gives a function of the arguments the port', async () => {
    const { apps, tell } = create(instance({ childOptions: { command: 'node', args: (given) => [`${given}`, '%port%'] } }));

    tell(4000);
    await new Promise(process.nextTick);

    expect(apps.start).toHaveBeenCalledWith(expect.any(String), 'child.localhost', 'node', ['4000', '4000']);
  });

  it('takes a port, a target and arguments of the configuration as they are written', async () => {
    const server = instance({ proxyOptions: { port }, serverOptions: { protocol: 'http', proxyTarget: `http://localhost:${port}` } });
    const { apps, child, tell } = create(server);

    expect(await (await get(child.handler)).text()).toBe('application');
    tell(port);
    await new Promise(process.nextTick);

    expect(apps.claim).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ port }));
    expect(apps.start).toHaveBeenCalledWith(expect.any(String), 'child.localhost', 'node', ['app.js', '--port=%PORT%']);
  });

  it('refuses a server with a port and no target, and one without its options', () => {
    expect(() => create(instance({ proxyOptions: { port } }))).toThrow('needs either a target');
    expect(() => create(instance({ childOptions: undefined }))).toThrow('are required for child servers');
  });

  it('releases the application when it is closed, and does not start it then', async () => {
    const { apps, child, tell } = create(instance());

    child.close();
    tell(port);
    await new Promise(process.nextTick);

    expect(apps.release).toHaveBeenCalledWith(expect.stringContaining('http child.localhost '));
    expect(apps.start).not.toHaveBeenCalled();
  });

  it('says that the application cannot be started, and fails the requests', async () => {
    const { child, refuse } = create(instance());

    refuse(new Error('No more available port left.'));

    expect((await get(child.handler)).status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('cannot be started'), expect.anything());
  });
});
