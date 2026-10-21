import { spawn } from 'child_process';
import express from 'express';
import http from 'http';
import net from 'net';
import { once } from 'events';
import proxyMiddleware from './proxy';
import { addPort, clearPorts } from '../utils';
import createMockLogger from '../utils/mock-logger.test-helper';
import type { ServerConfig, ServerRuntime } from '../types';

jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), spawn: jest.fn(() => ({ pid: 1 })) }));

const instance = (extra: Partial<ServerConfig> = {}): ServerConfig => ({
  hostname: 'child.localhost',
  protocol: 'http',
  type: 'child',
  childOptions: { command: 'node', args: ['server.js', '--port', '%PORT%'] },
  proxyOptions: {},
  serverOptions: { protocol: 'http' },
  ...extra,
});

describe('proxyMiddleware', () => {
  const start = (server: ServerConfig, runtime: ServerRuntime = {}) => proxyMiddleware(server, runtime, createMockLogger());

  beforeEach(() => {
    clearPorts();
    jest.mocked(spawn).mockClear();
  });

  it.each(['childOptions', 'proxyOptions', 'serverOptions'] as const)('requires %s', (option) => {
    expect(() => start(instance({ [option]: undefined }))).toThrow('required for child servers');
  });

  it('starts the child on a free port and proxies to it', () => {
    addPort(3001);
    const server = instance();
    const runtime: ServerRuntime = {};
    proxyMiddleware(server, runtime, createMockLogger());

    expect(spawn).toHaveBeenCalledWith('node', ['server.js', '--port', '3001'], { stdio: 'pipe' });
    expect(server.proxyOptions).toMatchObject({ hostname: 'localhost', port: [3001] });
    expect(server.serverOptions?.proxyTarget).toBe('http://localhost:3001');
    expect(runtime.child).toEqual({ pid: 1 });
  });

  it('lets the arguments be made from the port', () => {
    addPort(3002);
    const server = instance({ childOptions: { command: 'node', args: (port) => [`--p=${port}`, '%PORT%'] } });
    start(server);

    expect(spawn).toHaveBeenCalledWith('node', ['--p=3002', '3002'], { stdio: 'pipe' });
  });

  it('proxies https servers to the child over http', () => {
    addPort(3003);
    const server = instance({ serverOptions: { protocol: 'https' } });
    start(server);

    expect(server.serverOptions?.proxyTarget).toBe('http://localhost:3003');
  });

  it('keeps the port and the target it was given, and starts the child with the arguments as they are', () => {
    const server = instance({
      childOptions: { command: 'app', args: ['--port', '4000'] },
      proxyOptions: { hostname: 'example.test', port: 4000 },
      serverOptions: { protocol: 'http', proxyTarget: 'http://example.test:4000' },
    });
    start(server);

    expect(spawn).toHaveBeenCalledWith('app', ['--port', '4000'], { stdio: 'pipe' });
    expect(server.serverOptions?.proxyTarget).toBe('http://example.test:4000');
  });

  it('fails when there is no free port left for the child', () => {
    expect(() => start(instance())).toThrow('No more available port left.');
  });

  describe('requests', () => {
    const servers: net.Server[] = [];
    const listen = async <T extends net.Server>(server: T) => {
      servers.push(server);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();

      return address && typeof address === 'object' ? address.port : 0;
    };

    /** the front server of a child that listens on `childPort`, which is where the process would be */
    const startFront = async (childPort: number, runtime: ServerRuntime = {}) => {
      const server = instance({
        childOptions: { command: 'app', args: [] },
        proxyOptions: { hostname: '127.0.0.1', port: childPort },
        serverOptions: { protocol: 'http', proxyTarget: `http://127.0.0.1:${childPort}` },
      });
      const app = express();
      app.use(proxyMiddleware(server, runtime, createMockLogger()));

      return listen(http.createServer(app));
    };

    const get = (port: number) =>
      new Promise<{ status: number; text: string }>((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port, agent: false }, (response) => {
            const parts: Buffer[] = [];
            response.on('data', (part: Buffer) => parts.push(part));
            response.on('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(parts).toString('utf8') }));
          })
          .on('error', reject);
      });

    afterEach(() =>
      Promise.all(
        servers.splice(0).map((server) => {
          if (server instanceof http.Server) server.closeAllConnections();
          return new Promise((resolve) => server.close(resolve));
        })
      )
    );

    it('passes the requests on to the child', async () => {
      const childPort = await listen(http.createServer((_request, response) => response.end('child')));

      expect(await get(await startFront(childPort))).toEqual({ status: 200, text: 'child' });
    });

    it('answers 502 when the child cannot be reached', async () => {
      const closed = http.createServer();
      const childPort = await listen(closed);
      await new Promise((resolve) => closed.close(resolve));

      expect((await get(await startFront(childPort))).status).toBe(502);
    });

    it('connects a websocket to the child', async () => {
      const upstream = http.createServer();
      upstream.on('upgrade', (incoming: http.IncomingMessage, socket: net.Socket) => {
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
        socket.pipe(socket);
      });
      const front = await startFront(await listen(upstream));
      const client = net.connect(front, '127.0.0.1');
      let received = '';
      const echoed = new Promise<void>((resolve) =>
        client.on('data', (data: Buffer) => {
          received += data.toString('utf8');
          if (received.includes('\r\n\r\n') && !received.endsWith('ping')) client.write('ping');
          if (received.endsWith('ping')) resolve();
        })
      );
      client.write('GET /socket HTTP/1.1\r\nHost: child.localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');

      await echoed;
      client.destroy();
      expect(received).toMatch(/^HTTP\/1.1 101 Switching Protocols\r\n/);
    });

    it('closes the connections to the child through the runtime', async () => {
      const runtime: ServerRuntime = {};
      await startFront(1, runtime);

      expect(() => runtime.proxy?.close()).not.toThrow();
      expect(runtime.proxy).toBeDefined();
    });
  });
});
