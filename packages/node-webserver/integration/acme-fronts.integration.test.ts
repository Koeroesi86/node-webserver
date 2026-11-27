import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import tls from 'tls';
import startFakeAcmeServer from '../src/acme/fake-acme-server.test-helper';
import type { FakeAcmeServer } from '../src/acme/fake-acme-server.test-helper';

// a single core runs one front, whatever is asked for
const processes = os.availableParallelism() < 2 ? [1] : [1, 2];
const hostnames = ['first.example.com', 'second.example.com', 'third.example.com'];

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = net.createServer().listen(0, () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });

/** whether a new connection for the host gets a certificate that the root of the authority vouches for */
const handshakes = (port: number, hostname: string, ca: string) =>
  new Promise<boolean>((resolve) => {
    const socket = tls.connect({ port, host: '127.0.0.1', servername: hostname, ca }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });

describe.each(processes)('a server with %i front processes behind a primary, with certificates from an ACME server', (fronts) => {
  let folder: string;
  let httpsPort: number;
  let authority: FakeAcmeServer;
  let child: ReturnType<typeof spawn>;
  let output = '';
  /** writes the server of the file: without `acme` it serves plain http only */
  let writeServer: (acme: boolean) => void;

  beforeAll(async () => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'node-webserver-acme-'));
    const portHttp = await freePort();
    httpsPort = await freePort();
    authority = await startFakeAcmeServer(folder, () => portHttp);
    const file = path.join(folder, 'server.js');
    const options = { root: path.resolve(__dirname, 'fixtures/worker'), index: ['worker.js'] };
    const acme = { email: 'admin@example.com', storagePath: path.join(folder, 'storage'), directory: authority.directory, directoryCa: authority.ca };
    writeServer = (withAcme) =>
      fs.writeFileSync(
        file,
        `module.exports = ${JSON.stringify({ hostname: 'added.example.com', protocol: withAcme ? 'https' : 'http', ...(withAcme && { acme }), type: 'worker', options })};`
      );
    writeServer(false);
    child = spawn(process.execPath, [path.resolve(__dirname, 'fixtures/run-acme-server.js')], {
      env: {
        ...process.env,
        FRONT_PROCESSES: `${fronts}`,
        PORT_HTTP: `${portHttp}`,
        PORT_HTTPS: `${httpsPort}`,
        ACME_HOSTNAME: hostnames.join(),
        ACME_STORAGE: path.join(folder, 'storage'),
        ACME_DIRECTORY: authority.directory,
        ACME_CA: authority.ca,
        ACME_SERVER_FILE: file,
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
    await authority.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  });

  /** waits until every host is served with its certificate in every front: new connections, enough of them for every front to get some */
  const served = async (hosts: string[]) => {
    const root = fs.readFileSync(authority.root, 'utf8');
    const all = async () =>
      (await Promise.all(hosts.flatMap((hostname) => Array.from({ length: 4 * fronts }, () => handshakes(httpsPort, hostname, root))))).every(Boolean);
    const deadline = Date.now() + 45000;
    // the server tries a failed order again only after an hour, so a failure is the end of the wait
    while (!(await all()) && Date.now() < deadline && !output.includes('was not issued')) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (!(await all())) throw new Error(`The certificates are not served:\n${output}`);
  };

  it('orders each certificate once and serves it in every front, also the one of a server that is added later', async () => {
    await served(hostnames);
    expect([...authority.hostnames].sort()).toEqual([...hostnames].sort());

    writeServer(true);

    await served([...hostnames, 'added.example.com']);
    expect(authority.hostnames.slice(hostnames.length)).toEqual(['added.example.com']);
  }, 100000);
});
