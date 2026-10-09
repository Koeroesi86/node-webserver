import { spawnSync } from 'child_process';
import express from 'express';
import fs from 'fs';
import http2 from 'http2';
import https from 'https';
import os from 'os';
import path from 'path';
import tls from 'tls';
import type { AddressInfo } from 'net';
import createHttp2App from './create-http2-app';
import createHttpsServer from './create-https-server';
import type { HttpsApps } from './create-https-server';

const hostname = 'secure.localhost';

/** a self signed certificate of the host, made with openssl as node cannot make one */
const makeCertificate = () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'create-https-server-'));
  const key = path.join(folder, 'privkey.pem');
  const made = spawnSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', `/CN=${hostname}`, '-addext', `subjectAltName=DNS:${hostname}`, '-keyout', key],
    // Git Bash on Windows would turn the subject into a path. The certificate is on stdout, which the clients trust without reading it back from a file.
    { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, encoding: 'utf8' }
  );
  if (made.status !== 0) throw new Error(`openssl could not make a certificate: ${made.stderr}`);
  const pair = { key: fs.readFileSync(key, 'utf8'), cert: made.stdout };
  fs.rmSync(folder, { recursive: true, force: true });

  return pair;
};

/** both apps answer with the version of HTTP they were given, and which of them it was */
const createApps = (): HttpsApps => {
  const http1 = express();
  const http2App = createHttp2App();
  http1.use((request, response) => response.json({ app: 'http1', version: request.httpVersion, host: request.headers.host }));
  http2App.use((request, response) => response.json({ app: 'http2', version: request.httpVersion, host: request.headers.host }));

  return { http1, http2: http2App };
};

describe('createHttpsServer', () => {
  const pair = makeCertificate();
  const contexts = { [hostname]: tls.createSecureContext(pair) };
  const servers: Array<https.Server | http2.Http2SecureServer> = [];
  const sessions: http2.ClientHttp2Session[] = [];

  afterEach(async () => {
    sessions.splice(0).forEach((session) => session.destroy());
    await Promise.all(
      servers.splice(0).map((server) => {
        if (server instanceof https.Server) server.closeAllConnections();
        return new Promise((resolve) => server.close(resolve));
      })
    );
  });

  const listen = async (options: Parameters<typeof createHttpsServer>[2]) => {
    const server = createHttpsServer(contexts, createApps(), options);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    return (server.address() as AddressInfo).port;
  };

  const getHttp1 = (port: number, servername = hostname) =>
    new Promise<{ app: string; version: string; host: string }>((resolve, reject) => {
      https
        .get({ host: '127.0.0.1', port, servername, headers: { host: servername }, ca: pair.cert, agent: false }, (response) => {
          const parts: Buffer[] = [];
          response.on('data', (part: Buffer) => parts.push(part));
          response.on('end', () => resolve(JSON.parse(Buffer.concat(parts).toString())));
        })
        .on('error', reject);
    });

  const connectHttp2 = (port: number) => {
    const session = http2.connect(`https://${hostname}:${port}`, { host: '127.0.0.1', servername: hostname, ca: pair.cert });
    sessions.push(session);
    return session;
  };

  const getHttp2 = (session: http2.ClientHttp2Session) =>
    new Promise<{ app: string; version: string; host: string }>((resolve, reject) => {
      const stream = session.request({ ':path': '/' });
      const parts: Buffer[] = [];
      stream.on('data', (part: Buffer) => parts.push(part));
      stream.on('end', () => resolve(JSON.parse(Buffer.concat(parts).toString())));
      stream.on('error', reject);
      stream.end();
    });

  /** the protocol the server picks for a client that offers both */
  const negotiate = (port: number) =>
    new Promise<string | false>((resolve, reject) => {
      const socket = tls.connect({ host: '127.0.0.1', port, servername: hostname, ca: pair.cert, ALPNProtocols: ['h2', 'http/1.1'] }, () => {
        resolve(socket.alpnProtocol ?? false);
        socket.destroy();
      });
      socket.on('error', reject);
    });

  it('speaks HTTP/1.1 only when http2 is off', async () => {
    const port = await listen({});

    expect(await negotiate(port)).not.toBe('h2');
    expect(await getHttp1(port)).toEqual({ app: 'http1', version: '1.1', host: hostname });
  });

  it('serves HTTP/2 with the app of HTTP/2 when http2 is on', async () => {
    const port = await listen({ http2: true });

    expect(await negotiate(port)).toBe('h2');
    expect(await getHttp2(connectHttp2(port))).toEqual({ app: 'http2', version: '2.0', host: `${hostname}:${port}` });
  });

  it('serves the clients of HTTP/1.1 on the same port with the app of HTTP/1', async () => {
    const port = await listen({ http2: true });

    expect(await getHttp1(port)).toEqual({ app: 'http1', version: '1.1', host: hostname });
  });

  it.each([[false], [true]])('fails the handshake of a host without a certificate instead of waiting (http2: %s)', async (useHttp2) => {
    const port = await listen({ http2: useHttp2 });

    await expect(getHttp1(port, 'unknown.localhost')).rejects.toThrow();
  });

  it('closes a connection of HTTP/2 that stays idle for the keep alive timeout', async () => {
    const port = await listen({ http2: true, keepAliveTimeout: 100 });
    const session = connectHttp2(port);
    await getHttp2(session);

    await new Promise((resolve) => session.once('close', resolve));

    expect(session.closed).toBe(true);
  });
});
