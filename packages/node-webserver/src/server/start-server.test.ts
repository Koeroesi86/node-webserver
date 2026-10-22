import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import tls from 'tls';
import { getServerMetrics } from '@koeroesi86/node-worker-express';
import { setupShutdown } from '../utils';
import startServer from './start-server';
import startFakeAcmeServer from '../utils/fake-acme-server.test-helper';
import createMockLogger from '../utils/mock-logger.test-helper';

// the exit listeners belong to the process, not to the server under test
jest.mock('../utils/setup-shutdown', () => ({ __esModule: true, default: jest.fn() }));

describe('startServer', () => {
  const configuration = { servers: [], portHttp: 0, portHttps: 0, statsDomain: false as const, watchServers: false };

  it('rejects with all of the problems of the configuration, before anything listens', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');

    await expect(startServer({ ...configuration, portHtp: 80, portHttp: 8080, portHttps: 8080 } as object, createMockLogger())).rejects.toThrow(
      /portHtp is not a setting\nerror: portHttps listens on the port of portHttp too/
    );
    expect(listen).not.toHaveBeenCalled();
    listen.mockRestore();
  });

  it('gives every call apps of its own', async () => {
    // the call does not hand its servers back, so the ones that listen are closed through the spy
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const logger = createMockLogger();

    const first = await startServer(configuration, logger);
    const second = await startServer(configuration, logger);
    await Promise.all(listen.mock.contexts.map((server: net.Server) => new Promise((resolve) => server.close(resolve))));
    listen.mockRestore();

    expect(second.httpApp).not.toBe(first.httpApp);
    expect(second.httpsApp).not.toBe(first.httpsApp);
  });

  it('hands its logger on to the shutdown, which flushes it when the process exits', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const logger = createMockLogger();

    await startServer(configuration, logger);
    await Promise.all(listen.mock.contexts.map((server: net.Server) => new Promise((resolve) => server.close(resolve))));
    listen.mockRestore();

    expect(jest.mocked(setupShutdown).mock.calls.at(-1)?.[1]).toMatchObject({ logger });
  });

  it('hands back what takes the process listeners off again', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const remove = jest.fn();
    const exitListeners = process.listenerCount('exit');
    jest.mocked(setupShutdown).mockReturnValueOnce(remove);

    const server = await startServer(configuration, createMockLogger());
    server.removeProcessHooks();
    await Promise.all(listen.mock.contexts.map((context: net.Server) => new Promise((resolve) => context.close(resolve))));
    listen.mockRestore();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(process.listenerCount('exit')).toBe(exitListeners);
  });

  it('leaves the process listeners to the caller when it is told to', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const exitListeners = process.listenerCount('exit');
    jest.mocked(setupShutdown).mockClear();

    const server = await startServer(configuration, createMockLogger(), { processHooks: false });
    const during = process.listenerCount('exit');
    expect(() => server.removeProcessHooks()).not.toThrow();
    await Promise.all(listen.mock.contexts.map((context: net.Server) => new Promise((resolve) => context.close(resolve))));
    listen.mockRestore();

    expect(setupShutdown).not.toHaveBeenCalled();
    expect(during).toBe(exitListeners);
  });

  it('takes its metrics sources and its exit listener away once its servers closed', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const exitListeners = process.listenerCount('exit');
    const sources = () => Object.keys(getServerMetrics().sources);

    await startServer(configuration, createMockLogger());
    expect(sources()).toEqual(expect.arrayContaining(['workers', 'lambdas']));
    expect(process.listenerCount('exit')).toBe(exitListeners + 1);
    await Promise.all(listen.mock.contexts.map((context: net.Server) => new Promise((resolve) => context.close(resolve))));
    listen.mockRestore();

    expect(sources()).not.toContain('workers');
    expect(sources()).not.toContain('lambdas');
    expect(process.listenerCount('exit')).toBe(exitListeners);
  });

  it('leaves the listeners of the process at their start with two servers in one process', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const events = ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP', 'uncaughtException'];
    const counts = () => events.map((event) => process.listenerCount(event));
    const start = counts();
    // the real shutdown, as the listeners it adds are what must not be left behind
    jest.mocked(setupShutdown).mockImplementation(jest.requireActual('../utils/setup-shutdown').default);

    const first = await startServer(configuration, createMockLogger());
    const second = await startServer(configuration, createMockLogger());
    const during = counts();
    first.removeProcessHooks();
    second.removeProcessHooks();
    const afterRemove = counts();
    await Promise.all(listen.mock.contexts.map((context: net.Server) => new Promise((resolve) => context.close(resolve))));
    listen.mockRestore();
    jest.mocked(setupShutdown).mockReset();

    expect(during.every((count, index) => count > start[index])).toBe(true);
    expect(afterRemove).toEqual(start);
    expect(counts()).toEqual(start);
  });

  const freePort = () =>
    new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, () => {
        const { port } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(port));
      });
    });

  const until = async (done: () => boolean) => {
    const deadline = Date.now() + 15000;
    while (!done() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(done()).toBe(true);
  };

  const handshake = (port: number, servername: string) =>
    new Promise<string | undefined>((resolve) => {
      const socket = tls.connect({ port, host: '127.0.0.1', servername, rejectUnauthorized: false }, () => {
        const names = socket.getPeerCertificate().subjectaltname;
        socket.destroy();
        resolve(names);
      });
      socket.on('error', () => resolve(undefined));
    });

  it('gets the certificate of an acme server once it listens, answers the challenge before the redirect, and serves the certificate to new connections', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'start-server-acme-'));
    const [portHttp, portHttps] = [await freePort(), await freePort()];
    const authority = await startFakeAcmeServer(folder, () => portHttp);
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const logger = createMockLogger();
    const acme = { email: 'admin@example.com', storagePath: path.join(folder, 'storage'), directory: authority.directory, directoryCa: authority.ca };

    const server = await startServer(
      {
        ...configuration,
        portHttp,
        portHttps,
        servers: [{ hostname: 'secure.example.com', protocol: 'https', redirectHttp: true, acme, type: 'worker', options: { root: folder } }],
      },
      logger,
      { processHooks: false }
    );
    // no certificate yet
    expect(await handshake(portHttps, 'secure.example.com')).toBeUndefined();

    await until(() => logger.system.mock.calls.some(([line]) => String(line).includes('Servers loaded again')));
    const names = await handshake(portHttps, 'secure.example.com');
    const redirected = await new Promise<http.IncomingMessage>((resolve) =>
      http.get({ port: portHttp, host: '127.0.0.1', path: '/page', headers: { Host: 'secure.example.com' } }, (response) =>
        resolve(response.resume() && response)
      )
    );
    server.removeProcessHooks();
    await Promise.all(listen.mock.contexts.map((context: net.Server) => new Promise((resolve) => context.close(resolve))));
    listen.mockRestore();
    await authority.stop();
    fs.rmSync(folder, { recursive: true, force: true });

    expect(names).toBe('DNS:secure.example.com');
    expect(authority.hostnames).toEqual(['secure.example.com']);
    expect(redirected.statusCode).toBe(308);
  });
});
