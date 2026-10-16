import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SERVICE_SCRIPT_PATH } from '../constants';

// a signal cannot be sent to a process on Windows, which ends it at once
const describeWithSignals = process.platform === 'win32' ? describe.skip : describe;

const getFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (address && typeof address === 'object' ? resolve(address.port) : reject(new Error('No port was given.'))));
    });
  });

const isListening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => socket.end(() => resolve(true)));
    socket.once('error', () => resolve(false));
  });

const until = async (condition: () => Promise<boolean>) => {
  while (!(await condition())) await new Promise((resolve) => setTimeout(resolve, 50));
};

/** runs the built script, which is what the generated systemd unit and launchd plist start */
describeWithSignals('manageService.js --run', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'run-service-'));
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('stops on SIGTERM through the exit handler of the server, as a service manager stops it', async () => {
    const [portHttp, portHttps] = await Promise.all([getFreePort(), getFreePort()]);
    const configPath = join(folder, 'configuration.js');
    writeFileSync(
      configPath,
      `module.exports = ${JSON.stringify({ serviceName: 'nws', portHttp, portHttps, servers: [], watchServers: false, statsDomain: false })};`
    );
    const service = spawn(process.execPath, [SERVICE_SCRIPT_PATH, '--run', '--configuration', configPath], { stdio: 'ignore' });
    const exited = once(service, 'exit');

    await Promise.race([until(() => isListening(portHttp)), exited.then(() => Promise.reject(new Error('The service ended before it listened.')))]);
    service.kill('SIGTERM');

    // the server raises the signal again once it finished, which systemd counts as a clean stop of a unit it stopped
    const [code, signal] = await exited;
    expect(code ?? signal).toBe('SIGTERM');
  });

  it('exits non-zero without a configuration', async () => {
    const service = spawn(process.execPath, [SERVICE_SCRIPT_PATH, '--run'], { stdio: 'ignore', env: { ...process.env, NODE_WEBSERVER_CONFIG: '' } });

    const [code] = await once(service, 'exit');
    expect(code).toBe(1);
  });
});
