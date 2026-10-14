import { spawn } from 'child_process';
import httpProxy from 'http-proxy';
import proxyMiddleware from './proxy';
import { addPort, clearPorts } from '../utils/ports';
import type { ServerConfig, ServerRuntime } from '../types';

jest.mock('child_process', () => ({ spawn: jest.fn(() => ({ pid: 1 })) }));
jest.mock('http-proxy', () => ({ __esModule: true, default: { createProxyServer: jest.fn(() => ({ web: jest.fn() })) } }));

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
  const start = (server: ServerConfig, runtime: ServerRuntime = {}) => proxyMiddleware(server, runtime);

  beforeEach(() => {
    clearPorts();
    jest.mocked(spawn).mockClear();
    jest.mocked(httpProxy.createProxyServer).mockClear();
  });

  it.each(['childOptions', 'proxyOptions', 'serverOptions'] as const)('requires %s', (option) => {
    expect(() => start(instance({ [option]: undefined }))).toThrow('required for child servers');
  });

  it('starts the child on a free port and proxies to it', () => {
    addPort(3001);
    const server = instance();
    const runtime: ServerRuntime = {};
    proxyMiddleware(server, runtime);

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

  it('hands the requests to the proxy with the target', () => {
    addPort(3004);
    const server = instance();
    const runtime: ServerRuntime = {};
    const handler = proxyMiddleware(server, runtime);
    const request = {} as Parameters<typeof handler>[0];
    const response = {} as Parameters<typeof handler>[1];
    handler(request, response, jest.fn());

    expect(runtime.proxy?.web).toHaveBeenCalledWith(request, response, { target: 'http://localhost:3004' });
  });
});
