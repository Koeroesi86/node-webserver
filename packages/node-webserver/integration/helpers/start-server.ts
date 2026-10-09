import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import net from 'net';
import { join, resolve } from 'path';
import { request } from './request';
import type { Reply, RequestOptions } from './request';

export interface RunningServer {
  port: number;
  /** the https port, which serves HTTP/2 and HTTP/1.1, for `secure.localhost` and `secure-websocket.localhost` */
  httpsPort: number;
  /** the self signed certificate of the https hosts, to trust it instead of skipping the validation */
  certificate: string;
  /** a request to a virtual host of the server */
  get: (host: string, path?: string, options?: Omit<RequestOptions, 'port' | 'host' | 'path'>) => Promise<Reply>;
  stop: () => Promise<void>;
}

const startTimeout = 45000;

const getFreePort = () =>
  new Promise<number>((done, fail) => {
    const server = net.createServer();
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (address && typeof address === 'object' ? done(address.port) : fail(new Error('No port was given.'))));
    });
  });

const isListening = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => socket.end(() => done(true)));
    socket.once('error', () => done(false));
  });

/** a self signed certificate for the https hosts of the fixtures, in a folder of its own */
const makeCertificate = (folder: string) => {
  const [key, cert] = ['privkey.pem', 'cert.pem'].map((name) => join(folder, name));
  const made = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=secure.localhost',
      '-addext',
      'subjectAltName=DNS:secure.localhost,DNS:secure-websocket.localhost',
      '-keyout',
      key,
    ],
    // Git Bash on Windows would turn the subject into a path. The certificate is on stdout, which the tests trust without reading it back from a file.
    { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, encoding: 'utf8' }
  );
  if (made.status !== 0) throw new Error(`openssl could not make a certificate: ${made.stderr}`);
  fs.writeFileSync(cert, made.stdout);

  return { key, cert, certificate: made.stdout };
};

/** starts the built server with the servers of the fixtures in a process of its own, and resolves once it accepts connections */
export const startServer = async (): Promise<RunningServer> => {
  const [port, httpsPort, childPortFrom] = await Promise.all([getFreePort(), getFreePort(), getFreePort()]);
  const certificateFolder = fs.mkdtempSync(join(os.tmpdir(), 'node-webserver-integration-'));
  const { key, cert, certificate } = makeCertificate(certificateFolder);
  const child = spawn(process.execPath, [resolve(__dirname, '../fixtures/run-server.js')], {
    env: { ...process.env, PORT_HTTP: `${port}`, PORT_HTTPS: `${httpsPort}`, PORT_CHILD_FROM: `${childPortFrom}`, TLS_KEY: key, TLS_CERT: cert },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let exitCode: number | null | undefined;
  child.stdout.on('data', (data: Buffer) => (output += data));
  child.stderr.on('data', (data: Buffer) => (output += data));
  const exited = new Promise<void>((done) =>
    child.once('exit', (code) => {
      exitCode = code;
      done();
    })
  );

  const stop = async () => {
    if (exitCode === undefined) {
      child.kill();
    }
    await exited;
    fs.rmSync(certificateFolder, { recursive: true, force: true });
  };

  const deadline = Date.now() + startTimeout;

  while (!(await isListening(port))) {
    if (exitCode !== undefined || Date.now() > deadline) {
      await stop();
      throw new Error(`The server did not start (exit code ${exitCode}):\n${output}`);
    }

    await new Promise((done) => setTimeout(done, 100));
  }

  return { port, httpsPort, certificate, stop, get: (host, path, options) => request({ ...options, port, host, path }) };
};
