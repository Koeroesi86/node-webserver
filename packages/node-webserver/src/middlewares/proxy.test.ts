import { spawn } from 'child_process';
import httpProxy from 'http-proxy';
import proxyMiddleware from './proxy';
import { addPort, clearPorts } from '../utils/ports';
import type { ServerInstance } from '../types';

jest.mock('child_process', () => ({ spawn: jest.fn(() => ({ pid: 1 })) }));
jest.mock('http-proxy', () => ({ __esModule: true, default: { createProxyServer: jest.fn(() => ({ web: jest.fn() })) } }));

const instance = (extra: Partial<ServerInstance> = {}): ServerInstance => ({
  hostname: 'child.localhost',
  protocol: 'http',
  type: 'child',
  childOptions: { command: 'node', args: ['server.js', '--port', '%PORT%'] },
  proxyOptions: {},
  serverOptions: { protocol: 'http' },
  ...extra,
});

describe('proxyMiddleware', () => {
  beforeEach(() => {
    clearPorts();
    jest.mocked(spawn).mockClear();
    jest.mocked(httpProxy.createProxyServer).mockClear();
  });

  it.each(['childOptions', 'proxyOptions', 'serverOptions'] as const)('requires %s', (option) => {
    expect(() => proxyMiddleware(instance({ [option]: undefined }))).toThrow('required for child servers');
  });

  it('starts the child on a free port and proxies to it', () => {
    addPort(3001);
    const server = instance();
    proxyMiddleware(server);

    expect(spawn).toHaveBeenCalledWith('node', ['server.js', '--port', '3001'], { stdio: 'pipe' });
    expect(server.proxyOptions).toMatchObject({ hostname: 'localhost', port: [3001] });
    expect(server.serverOptions?.proxyTarget).toBe('http://localhost:3001');
    expect(server.child).toEqual({ pid: 1 });
  });

  it('lets the arguments be made from the port', () => {
    addPort(3002);
    const server = instance({ childOptions: { command: 'node', args: (port) => [`--p=${port}`, '%PORT%'] } });
    proxyMiddleware(server);

    expect(spawn).toHaveBeenCalledWith('node', ['--p=3002', '3002'], { stdio: 'pipe' });
  });

  it('proxies https servers to the child over http', () => {
    addPort(3003);
    const server = instance({ serverOptions: { protocol: 'https' } });
    proxyMiddleware(server);

    expect(server.serverOptions?.proxyTarget).toBe('http://localhost:3003');
  });

  it('keeps the port and the target it was given, and starts the child with the arguments as they are', () => {
    const server = instance({
      childOptions: { command: 'app', args: ['--port', '4000'] },
      proxyOptions: { hostname: 'example.test', port: 4000 },
      serverOptions: { protocol: 'http', proxyTarget: 'http://example.test:4000' },
    });
    proxyMiddleware(server);

    expect(spawn).toHaveBeenCalledWith('app', ['--port', '4000'], { stdio: 'pipe' });
    expect(server.serverOptions?.proxyTarget).toBe('http://example.test:4000');
  });

  it('fails when there is no free port left for the child', () => {
    expect(() => proxyMiddleware(instance())).toThrow('No more available port left.');
  });

  it('hands the requests to the proxy with the target', () => {
    addPort(3004);
    const server = instance();
    const handler = proxyMiddleware(server);
    const request = {} as Parameters<typeof handler>[0];
    const response = {} as Parameters<typeof handler>[1];
    handler(request, response, jest.fn());

    expect(server.proxy?.web).toHaveBeenCalledWith(request, response, { target: 'http://localhost:3004' });
  });
});
