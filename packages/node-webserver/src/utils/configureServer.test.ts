import http from 'http';
import net from 'net';
import { getServerMetrics } from '@koeroesi86/node-worker-express';
import { DEFAULT_KEEP_ALIVE_TIMEOUT, DEFAULT_MAX_CONNECTIONS } from '../constants';
import configureServer from './configureServer';

describe('configureServer', () => {
  let server: http.Server;
  const sockets: net.Socket[] = [];

  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.destroy());
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const listen = async (name: string, options: Parameters<typeof configureServer>[2]) => {
    server = http.createServer((request, response) => response.end('ok'));
    configureServer(server, name, options);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const address = server.address();
    if (typeof address !== 'object' || address === null) throw new Error('The server does not listen on a port.');

    return address.port;
  };

  const connect = async (port: number) => {
    const socket = net.connect(port, '127.0.0.1');
    sockets.push(socket);
    socket.on('error', () => {});
    await new Promise((resolve) => socket.once('connect', resolve));

    return socket;
  };

  const metricsOf = (name: string) => getServerMetrics().sources[`connections:${name}`];
  const until = async (condition: () => boolean) => {
    for (let waited = 0; !condition() && waited < 3000; waited += 5) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(condition()).toBe(true);
  };

  it('applies the keep-alive timeout and the connection limit', async () => {
    await listen('applied', { keepAliveTimeout: 12000, maxConnections: 7 });

    expect(server.keepAliveTimeout).toBe(12000);
    expect(server.maxConnections).toBe(7);
  });

  it('has defaults, a keep-alive timeout longer than the 5 seconds of node and a limit', async () => {
    await listen('defaults', {});

    expect(server.keepAliveTimeout).toBe(DEFAULT_KEEP_ALIVE_TIMEOUT);
    expect(DEFAULT_KEEP_ALIVE_TIMEOUT).toBeGreaterThan(60000);
    expect(server.maxConnections).toBe(DEFAULT_MAX_CONNECTIONS);
  });

  it('keeps the time for the headers longer than the keep-alive timeout', async () => {
    await listen('headers', { keepAliveTimeout: 120000 });

    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });

  it('does not shorten the time for the headers that node has by default', async () => {
    await listen('headers-short', { keepAliveTimeout: 1000 });

    expect(server.headersTimeout).toBeGreaterThanOrEqual(60000);
  });

  it('drops connections beyond the limit, and counts them', async () => {
    const port = await listen('limited', { maxConnections: 2 });

    const first = await connect(port);
    await connect(port);
    const third = await connect(port);

    await until(() => third.destroyed);
    expect(first.destroyed).toBe(false);
    expect(metricsOf('limited')).toMatchObject({ open: 2, dropped: 1, maxConnections: 2 });
  });

  it('does not limit connections when the limit is 0', async () => {
    const port = await listen('unlimited', { maxConnections: 0 });

    const connections = await Promise.all(Array.from({ length: 20 }, () => connect(port)));

    await until(() => (metricsOf('unlimited') as { open: number }).open === 20);
    expect(connections.every((socket) => !socket.destroyed)).toBe(true);
    expect(metricsOf('unlimited')).toMatchObject({ dropped: 0 });
  });

  it('counts the connections that are open, and stops counting the ones that closed', async () => {
    const port = await listen('counted', { maxConnections: 10 });

    const first = await connect(port);
    await connect(port);
    await until(() => (metricsOf('counted') as { open: number }).open === 2);
    first.destroy();

    await until(() => (metricsOf('counted') as { open: number }).open === 1);
    expect(metricsOf('counted')).toMatchObject({ keepAliveTimeout: DEFAULT_KEEP_ALIVE_TIMEOUT });
  });
});
