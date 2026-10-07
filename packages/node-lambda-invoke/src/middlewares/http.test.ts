import childProcess, { ChildProcess, fork } from 'child_process';
import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import ts from 'typescript';
import type { HttpMiddlewareOptions } from '../types';

/** the lambdas of the tests, selected by the path of the request */
const lambdaSource = `
// the pool keeps its lambdas running, so every one of them reports itself to be stopped after the tests
require('fs').appendFileSync(process.env.PID_FILE, process.pid + '\\n');

exports.handler = (event, context, callback) => {
  const respond = () => callback(null, { statusCode: 200, headers: { 'x-pid': String(process.pid) }, body: 'echo ' + event.path });
  if (event.path === '/exit') process.exit(1);
  if (event.path === '/slow') return setTimeout(respond, 100);
  respond();
};
`;

/** starts a server with the middleware in a process of its own, to see what happens to the lambdas when it is killed */
const parentSource = `
const http = require('http');
const { httpMiddleware } = require('./index');
const server = http.createServer(httpMiddleware({ lambdaPath: process.argv[2], communication: { type: 'ipc' } }));
server.listen(0, () => {
  http.get('http://localhost:' + server.address().port + '/', (response) => {
    response.resume().on('end', () => process.send({ pid: response.headers['x-pid'] }));
  });
});
`;

const processExists = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('httpMiddleware', () => {
  let build: string;
  let lambdaPath: string;
  let pidFile: string;
  let server: http.Server;
  let baseUrl: string;
  const spawned: ChildProcess[] = [];

  beforeAll(async () => {
    // transpiled next to the sources, so that the modules find the dependencies of the package, and the lambda processes the compiled files
    build = await fs.mkdtemp(path.join(__dirname, '../..', '.test-build-'));
    const compile = (source: string) =>
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true },
      }).outputText;
    const sources = (await fs.readdir(path.join(__dirname, '..'), { recursive: true })).filter(
      (file) => /\.(ts|json)$/.test(file) && !file.endsWith('.test.ts')
    );
    await Promise.all(
      sources.map(async (file) => {
        const content = await fs.readFile(path.join(__dirname, '..', file), 'utf8');
        await fs.mkdir(path.dirname(path.join(build, file)), { recursive: true });
        await fs.writeFile(path.join(build, file.replace(/\.ts$/, '.js')), file.endsWith('.json') ? content : compile(content));
      })
    );
    lambdaPath = path.join(build, 'lambda.js');
    pidFile = path.join(build, 'pids');
    process.env.PID_FILE = pidFile;
    await fs.writeFile(lambdaPath, lambdaSource);
    await fs.writeFile(path.join(build, 'parent.js'), parentSource);
  });

  afterAll(async () => {
    const pids = (await fs.readFile(pidFile, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(Number);
    pids.filter(processExists).forEach((pid) => process.kill(pid, 'SIGKILL'));
    await fs.rm(build, { recursive: true, force: true });
  });

  afterEach(async () => {
    spawned.splice(0).forEach((process) => process.kill('SIGKILL'));
    if (server) {
      // keep-alive connections of the test client would keep it open
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  const start = async (options: Partial<HttpMiddlewareOptions> = {}) => {
    // loaded late, as the build only exists once the tests run
    const { httpMiddleware } = require(path.join(build, 'index.js'));
    server = http.createServer(httpMiddleware({ lambdaPath, communication: { type: 'ipc' }, ...options }));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${(server.address() as { port: number }).port}`;
  };

  it('answers with what the lambda responds with', async () => {
    await start();

    const response = await fetch(`${baseUrl}/hello`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('echo /hello');
  });

  it('reuses a lambda while it is free', async () => {
    await start();

    const first = await fetch(`${baseUrl}/`);
    const second = await fetch(`${baseUrl}/`);

    expect(first.headers.get('x-pid')).toBe(second.headers.get('x-pid'));
  });

  it('starts another lambda while the others are busy', async () => {
    await start();

    const pids = await Promise.all([1, 2, 3].map(async () => (await fetch(`${baseUrl}/slow`)).headers.get('x-pid')));

    expect(new Set(pids).size).toBe(3);
  });

  it('gives every concurrent request its own answer, one lambda handles one request at a time', async () => {
    await start();

    const answers = await Promise.all(Array.from({ length: 30 }, async (_, index) => (await fetch(`${baseUrl}/slow/${index}`)).text()));

    expect(answers).toEqual(Array.from({ length: 30 }, (_, index) => `echo /slow/${index}`));
  });

  it('does not collect listeners on the lambda with every request', async () => {
    // the pool keeps lambdas per file, so this one gets a lambda of its own that the spy sees being started
    const ownLambdaPath = path.join(build, 'own-lambda.js');
    await fs.copyFile(lambdaPath, ownLambdaPath);
    const spawn = jest.spyOn(childProcess, 'spawn');
    await start({ lambdaPath: ownLambdaPath });

    try {
      for (let request = 0; request < 30; request += 1) {
        await (await fetch(`${baseUrl}/${request}`)).text();
      }
      // the storage of a request lets go of the lambda after the response was handed over
      await new Promise((resolve) => setTimeout(resolve, 50));

      const lambda = spawn.mock.results[0].value as ChildProcess;
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(lambda.listenerCount('message')).toBeLessThan(5);
      expect(lambda.listenerCount('close')).toBeLessThan(5);
    } finally {
      spawn.mockRestore();
    }
  });

  it('answers 502 when the lambda exits during the request', async () => {
    await start();

    const response = await fetch(`${baseUrl}/exit`);

    expect(response.status).toBe(502);
  });

  it('keeps answering after a lambda was lost', async () => {
    await start();
    await fetch(`${baseUrl}/exit`);

    const response = await fetch(`${baseUrl}/after`);

    expect(await response.text()).toBe('echo /after');
  });

  it('answers 500 instead of waiting when the lambda cannot start', async () => {
    await start({ lambdaPath: path.join(build, 'missing.js') });

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(500);
  });

  it('stops the lambdas when the process that started them is killed', async () => {
    const parent = fork(path.join(build, 'parent.js'), [lambdaPath], { env: process.env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    spawned.push(parent);
    const { pid } = await new Promise<{ pid: string }>((resolve) => parent.once('message', (message) => resolve(message as { pid: string })));
    expect(processExists(Number(pid))).toBe(true);

    parent.kill('SIGKILL');

    for (let waited = 0; processExists(Number(pid)) && waited < 5000; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(processExists(Number(pid))).toBe(false);
  });
});
