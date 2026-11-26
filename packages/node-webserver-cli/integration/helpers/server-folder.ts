import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';

export const CLI = path.resolve(__dirname, '../../dist/scripts/cli.js');

const getFreePort = () =>
  new Promise<number>((done, fail) => {
    const server = net.createServer();
    server.on('error', fail);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => (address && typeof address === 'object' ? done(address.port) : fail(new Error('No port was given.'))));
    });
  });

export interface Answer {
  status: number;
  /** of the worker that answered */
  worker?: number;
  /** of the front that started that worker */
  front?: number;
}

/** whether the process is there, also one of another user, which may not be signalled */
export const isAlive = (pid: number) => {
  try {
    return process.kill(pid, 0);
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
};

/** waits until the condition holds, as the server does things some time after it is asked to. `describe` says why it did not. */
export const until = async (condition: () => Promise<boolean> | boolean, describe: () => string, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  while (!(await condition()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!(await condition())) throw new Error(`The condition did not hold within ${timeout}ms. ${describe()}`);
};

/** answers with its process and the front that started it. With `?wait` it writes a file once it has the request, and answers that many milliseconds later. */
const worker = `module.exports = (event, callback) => {
  const wait = Number(event.queryStringParameters.wait || 0);
  if (wait) require('fs').writeFileSync(require('path').join(__dirname, 'waiting'), '');
  const body = JSON.stringify({ worker: process.pid, front: process.ppid });
  setTimeout(() => callback({ statusCode: 200, headers: {}, body, isBase64Encoded: false }), wait);
};`;

/**
 * A folder with a configuration for the command line and a worker. Every process that loads the configuration writes its id down, the server that the launcher started
 * and the fronts among them.
 */
export const createServerFolder = async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nws-cli-integration-')));
  const configurationFile = path.join(folder, 'configuration.js');
  const processFile = path.join(folder, 'processes');
  const root = path.join(folder, 'worker');
  const [portHttp, portHttps] = await Promise.all([getFreePort(), getFreePort()]);
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'worker.js'), worker);

  const server = (hostname: string, extra: object = {}) => ({
    hostname,
    protocol: 'http',
    type: 'worker',
    options: { root, index: ['worker.js'] },
    ...extra,
  });

  const write = (content: string) => fs.writeFileSync(configurationFile, content);

  /** the configuration with `settings` over it, and `servers` next to the server of `web.localhost` */
  const configure = (settings: object = {}, servers: Array<object | string> = []) => {
    const configuration = {
      fileLogPath: false,
      logLevels: { system: true, info: false, success: false, error: true, warning: true },
      portHttp,
      portHttps,
      statsDomain: false,
      ...settings,
      servers: [server('web.localhost'), ...servers],
    };
    write(`require('fs').appendFileSync(${JSON.stringify(processFile)}, process.pid + '\\n');\nmodule.exports = ${JSON.stringify(configuration)};`);
  };

  /** a request on a connection of its own, with 0 as the status when it failed */
  const get = (host = 'web.localhost', path = '/') =>
    new Promise<Answer>((resolve) => {
      const outgoing = http.get(
        { host: '127.0.0.1', port: portHttp, path, headers: { Host: host }, agent: false, signal: AbortSignal.timeout(10000) },
        (response) => {
          let text = '';
          response.on('data', (part: Buffer) => (text += part));
          response.on('error', () => resolve({ status: 0 }));
          response.on('end', () => resolve({ status: response.statusCode ?? 0, ...(text.startsWith('{"worker"') && JSON.parse(text)) }));
        }
      );
      outgoing.on('error', () => resolve({ status: 0 }));
    });

  return {
    folder,
    configurationFile,
    portHttp,
    portHttps,
    server,
    write,
    configure,
    get,
    /** whether a request with `?wait` reached its worker */
    isWaiting: () => fs.existsSync(path.join(root, 'waiting')),
    /** every process that loaded the configuration */
    processes: () => (fs.existsSync(processFile) ? Array.from(new Set(fs.readFileSync(processFile, 'utf8').split('\n').filter(Boolean).map(Number))) : []),
    remove: () => fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5 }),
  };
};

export type ServerFolder = Awaited<ReturnType<typeof createServerFolder>>;
