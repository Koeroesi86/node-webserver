import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import https from 'https';
import net from 'net';
import os from 'os';
import path from 'path';
import tls from 'tls';

// Pebble is the test server of Let's Encrypt, which the pipeline starts (see `pebble` in `pr-checks.yml`). Without it there is nothing to talk to, so the suite is skipped.
const { PEBBLE_DIRECTORY, PEBBLE_CA, PEBBLE_HTTP_PORT, PEBBLE_ROOTS } = process.env;
const describePebble = PEBBLE_DIRECTORY && PEBBLE_CA && PEBBLE_HTTP_PORT && PEBBLE_ROOTS ? describe : describe.skip;

const hostname = 'acme.example.com';

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = net.createServer().listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

const handshake = (port: number, ca: string) =>
  new Promise<tls.PeerCertificate | undefined>((resolve) => {
    const socket = tls.connect({ port, host: '127.0.0.1', servername: hostname, ca }, () => {
      const certificate = socket.getPeerCertificate();
      socket.destroy();
      resolve(certificate);
    });
    socket.on('error', () => resolve(undefined));
  });

const fetchRoot = (url: string, ca: string) =>
  new Promise<string>((resolve, reject) => {
    https
      .get(url, { ca }, (response) => {
        const parts: Buffer[] = [];
        response.on('data', (part: Buffer) => parts.push(part));
        response.on('end', () =>
          response.statusCode === 200 ? resolve(Buffer.concat(parts).toString('utf8')) : reject(new Error(`${url} answered ${response.statusCode}`))
        );
      })
      .on('error', reject);
  });

describePebble('an https server that gets its certificate from Pebble', () => {
  let folder: string;
  let httpsPort: number;
  let output = '';
  let root: string;
  let child: ReturnType<typeof spawn>;

  beforeAll(async () => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'node-webserver-pebble-'));
    httpsPort = await freePort();
    root = await fetchRoot(String(PEBBLE_ROOTS), fs.readFileSync(String(PEBBLE_CA), 'utf8'));
    // Pebble asks the host name of this one on the port it was started with, so the http port is not a free one
    child = spawn(process.execPath, [path.resolve(__dirname, 'fixtures/run-acme-server.js')], {
      env: {
        ...process.env,
        PORT_HTTP: String(PEBBLE_HTTP_PORT),
        PORT_HTTPS: String(httpsPort),
        ACME_HOSTNAME: hostname,
        ACME_STORAGE: path.join(folder, 'storage'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (data: Buffer) => (output += data));
    child.stderr?.on('data', (data: Buffer) => (output += data));
  });

  afterAll(async () => {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
    fs.rmSync(folder, { recursive: true, force: true });
  });

  const issued = async () => {
    const deadline = Date.now() + 45000;
    let certificate = await handshake(httpsPort, root);
    while (!certificate && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      certificate = await handshake(httpsPort, root);
    }

    return certificate;
  };

  it('gets a certificate for its name that a client trusting the roots of Pebble accepts', async () => {
    const certificate = await issued();

    expect({ names: certificate?.subjectaltname, output: certificate ? '' : output }).toEqual({ names: `DNS:${hostname}`, output: '' });
  });

  it('keeps the certificate and the key where the configuration says, and the key private', async () => {
    await issued();
    const files = path.join(folder, 'storage', hostname);

    expect(fs.readFileSync(path.join(files, 'fullchain.pem'), 'utf8')).toContain('BEGIN CERTIFICATE');
    expect(fs.readFileSync(path.join(files, 'privkey.pem'), 'utf8')).toContain('PRIVATE KEY');
    if (process.platform !== 'win32') expect(fs.statSync(path.join(files, 'privkey.pem')).mode & 0o777).toBe(0o600);
  });

  it('redirects plain http to https while the challenge path is answered before the hosts', async () => {
    await issued();

    const reply = await new Promise<http.IncomingMessage>((resolve, reject) =>
      http
        .get({ port: Number(PEBBLE_HTTP_PORT), host: '127.0.0.1', path: '/page?a=1', headers: { Host: hostname } }, (response) =>
          resolve(response.resume() && response)
        )
        .on('error', reject)
    );

    expect(reply.statusCode).toBe(308);
    expect(reply.headers.location).toBe(`https://${hostname}:${httpsPort}/page?a=1`);
  });
});
