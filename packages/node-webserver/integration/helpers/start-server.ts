import { spawn } from 'child_process';
import net from 'net';
import { resolve } from 'path';
import { request } from './request';
import type { Reply, RequestOptions } from './request';

export interface RunningServer {
  port: number;
  /** a request to a virtual host of the server */
  get: (host: string, path?: string, options?: Omit<RequestOptions, 'port' | 'host' | 'path'>) => Promise<Reply>;
  stop: () => Promise<void>;
  /** what the server wrote to its stdout and stderr so far */
  output: () => string;
  /** loads the servers again, as `reload` of `startServer` does, which works on every platform unlike a signal */
  reload: () => void;
  signal: (signal: NodeJS.Signals) => void;
  /** whether the process ended */
  hasExited: () => boolean;
  /** resolves once the process ended */
  exited: Promise<void>;
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

/** starts the built server with the servers of the fixtures in a process of its own, and resolves once it accepts connections. `env` goes to the configuration of the fixtures. */
export const startServer = async (env: Record<string, string> = {}): Promise<RunningServer> => {
  const [port, httpsPort, childPortFrom, closedPort] = await Promise.all([getFreePort(), getFreePort(), getFreePort(), getFreePort()]);
  const child = spawn(process.execPath, [resolve(__dirname, '../fixtures/run-server.js')], {
    env: { ...process.env, ...env, PORT_HTTP: `${port}`, PORT_HTTPS: `${httpsPort}`, PORT_CHILD_FROM: `${childPortFrom}`, PORT_CLOSED: `${closedPort}` },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  let exitCode: number | null | undefined;
  child.stdout?.on('data', (data: Buffer) => (output += data));
  child.stderr?.on('data', (data: Buffer) => (output += data));
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
  };

  const deadline = Date.now() + startTimeout;

  while (!(await isListening(port))) {
    if (exitCode !== undefined || Date.now() > deadline) {
      await stop();
      throw new Error(`The server did not start (exit code ${exitCode}):\n${output}`);
    }

    await new Promise((done) => setTimeout(done, 100));
  }

  return {
    port,
    stop,
    output: () => output,
    reload: () => child.send('reload'),
    signal: (signal) => child.kill(signal),
    hasExited: () => exitCode !== undefined,
    exited,
    get: (host, path, options) => request({ ...options, port, host, path }),
  };
};
