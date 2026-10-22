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
import makeCertificate from '../utils/make-certificate.test-helper';
import createMockLogger from '../utils/mock-logger.test-helper';

// the exit listeners belong to the process, not to the server under test
jest.mock('../utils/setup-shutdown', () => ({ __esModule: true, default: jest.fn() }));

describe('startServer', () => {
  // openssl makes the certificates of the fake authority and an order is made once the server listens, which takes more than the 5 seconds of a test on a busy runner
  jest.setTimeout(30000);

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

  const handshake = (port: number, servername: string, ca?: Buffer) =>
    new Promise<string | undefined>((resolve) => {
      const socket = tls.connect({ port, host: '127.0.0.1', servername, ca }, () => {
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
    const names = await handshake(portHttps, 'secure.example.com', fs.readFileSync(authority.root));
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

  it('replaces the certificate for new connections when it renews, and leaves a connection that is open as it is', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'start-server-renewal-'));
    const [portHttp, portHttps] = [await freePort(), await freePort()];
    const authority = await startFakeAcmeServer(folder, () => portHttp);
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const logger = createMockLogger();
    const storagePath = path.join(folder, 'storage');
    const hostname = 'secure.example.com';
    // a certificate of 30 days is due when 60 days are the margin, so the renewer replaces it as soon as the server listens
    const old = makeCertificate(folder, hostname);
    fs.mkdirSync(path.join(storagePath, hostname), { recursive: true });
    fs.copyFileSync(old.key, path.join(storagePath, hostname, 'privkey.pem'));
    fs.copyFileSync(old.cert, path.join(storagePath, hostname, 'fullchain.pem'));
    const acme = { email: 'admin@example.com', storagePath, directory: authority.directory, directoryCa: authority.ca, renewBeforeDays: 60 };
    const ca = [fs.readFileSync(old.cert), fs.readFileSync(authority.root)];
    const fingerprint = (socket: tls.TLSSocket) => socket.getPeerCertificate().fingerprint256;
    const request = (socket: tls.TLSSocket) =>
      new Promise<string>((resolve) => {
        socket.once('data', (data) => resolve(data.toString().split('\r\n')[0]));
        socket.write(`GET /missing HTTP/1.1\r\nHost: ${hostname}\r\n\r\n`);
      });

    const server = await startServer(
      { ...configuration, portHttp, portHttps, servers: [{ hostname, protocol: 'https', acme, type: 'worker', options: { root: folder } }] },
      logger,
      { processHooks: false }
    );
    const open = await new Promise<tls.TLSSocket>((resolve) => {
      const socket: tls.TLSSocket = tls.connect({ port: portHttps, host: '127.0.0.1', servername: hostname, ca }, () => resolve(socket));
    });
    const before = fingerprint(open);
    const statusBefore = await request(open);

    await until(() => logger.system.mock.calls.some(([line]) => String(line).includes('Servers loaded again')));
    const statusAfter = await request(open);
    const fresh = await new Promise<tls.TLSSocket>((resolve) => {
      const socket: tls.TLSSocket = tls.connect({ port: portHttps, host: '127.0.0.1', servername: hostname, ca }, () => resolve(socket));
    });
    const renewed = fingerprint(fresh);
    const held = fingerprint(open);
    open.destroy();
    fresh.destroy();
    server.removeProcessHooks();
    await Promise.all(listen.mock.contexts.map((context: net.Server) => new Promise((resolve) => context.close(resolve))));
    listen.mockRestore();
    await authority.stop();
    fs.rmSync(folder, { recursive: true, force: true });

    expect(renewed).not.toBe(before);
    expect(held).toBe(before);
    expect(statusBefore).toMatch(/^HTTP\/1\.1 /);
    expect(statusAfter).toMatch(/^HTTP\/1\.1 /);
    expect(authority.hostnames).toEqual([hostname]);
  });
});
