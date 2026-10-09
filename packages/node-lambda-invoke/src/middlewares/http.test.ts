import childProcess, { ChildProcess, fork } from 'child_process';
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
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
  if (event.path.startsWith('/slow')) return setTimeout(respond, 100);
  if (event.path === '/hold') return setTimeout(respond, 400);
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

/** a process can leave between looking for it and killing it (slow to tear down on Windows), which is what is wanted here */
const killIfExists = (pid: number) => {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
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
    pids.forEach(killIfExists);
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

  /** the pool keeps its lambdas in the module, so every test gets the module anew; loaded late, as the build only exists once the tests run */
  const load = () => {
    jest.resetModules();
    return require(path.join(build, 'index.js'));
  };

  const start = async (options: Partial<HttpMiddlewareOptions> = {}) => {
    const { httpMiddleware } = load();
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
    // without a limit: the default is the number of cores, which a small machine does not have three of
    await start({ limit: 0 });

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

  describe('limit', () => {
    const pidsOf = async (count: number, requestPath = '/slow') => {
      const responses = await Promise.all(Array.from({ length: count }, () => fetch(`${baseUrl}${requestPath}`)));

      return { statuses: responses.map(({ status }) => status), pids: responses.map((response) => response.headers.get('x-pid')) };
    };

    it('never runs more lambdas than the limit, and answers every request', async () => {
      await start({ limit: 2 });

      const { statuses, pids } = await pidsOf(6);

      expect(statuses).toEqual(Array(6).fill(200));
      expect(new Set(pids).size).toBeLessThanOrEqual(2);
    });

    it('answers 503 when no lambda becomes free in time', async () => {
      await start({ limit: 1, acquireTimeout: 50 });

      // both hold the lambda for longer than the wait, whichever arrives first gets it
      const responses = await Promise.all([fetch(`${baseUrl}/hold`), fetch(`${baseUrl}/hold`)]);

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 503]);
    });

    it('keeps one busy file from using up the limit of the others', async () => {
      const { httpMiddleware } = load();
      const otherLambdaPath = path.join(build, 'other-lambda.js');
      await fs.copyFile(lambdaPath, otherLambdaPath);
      const create = (file: string) => http.createServer(httpMiddleware({ lambdaPath: file, limit: 2, communication: { type: 'ipc' } }));
      const [busy, other] = [create(lambdaPath), create(otherLambdaPath)];
      await Promise.all([busy, other].map((instance) => new Promise<void>((resolve) => instance.listen(0, resolve))));
      const urlOf = (instance: http.Server) => `http://localhost:${(instance.address() as { port: number }).port}`;

      try {
        const first = await Promise.all([fetch(`${urlOf(busy)}/slow`), fetch(`${urlOf(busy)}/slow`)]);
        const busyPids = first.map((response) => Number(response.headers.get('x-pid')));
        expect(new Set(busyPids).size).toBe(2);

        const response = await fetch(`${urlOf(other)}/`);

        expect(response.status).toBe(200);
        for (let waited = 0; busyPids.every(processExists) && waited < 3000; waited += 50) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(busyPids.filter(processExists)).toHaveLength(1);
      } finally {
        [busy, other].forEach((instance) => instance.closeAllConnections());
        await Promise.all([busy, other].map((instance) => new Promise((resolve) => instance.close(resolve))));
      }
    });

    it('allows as many lambdas as there are CPU cores by default', async () => {
      await start();

      const { statuses, pids } = await pidsOf(40);

      expect(statuses).toEqual(Array(40).fill(200));
      expect(new Set(pids).size).toBeLessThanOrEqual(os.availableParallelism());
    });

    it('has no limit when it is 0', async () => {
      await start({ limit: 0 });

      const { pids } = await pidsOf(8);

      expect(new Set(pids).size).toBe(8);
    });
  });

  describe('stats', () => {
    it('is empty before a lambda was started', async () => {
      const { getLambdaStats } = load();

      expect(getLambdaStats()).toEqual({ lambdas: 0, starting: 0, busy: 0, files: {} });
    });

    it('counts the lambdas, and the ones that are busy, per file', async () => {
      // without a limit: the default is the number of cores, which a small machine does not have two of
      await start({ limit: 0 });
      const { getLambdaStats } = require(path.join(build, 'index.js'));

      const responses = Promise.all([fetch(`${baseUrl}/hold`), fetch(`${baseUrl}/hold`)]);
      // both lambdas have to be started and holding their request, which takes longer on a slow machine
      for (let waited = 0; getLambdaStats().busy < 2 && waited < 3000; waited += 10) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const during = getLambdaStats();
      await responses;
      const after = getLambdaStats();

      expect(during).toMatchObject({ lambdas: 2, busy: 2, starting: 0, files: { [lambdaPath]: { lambdas: 2, busy: 2 } } });
      expect(after).toMatchObject({ lambdas: 2, busy: 0, files: { [lambdaPath]: { lambdas: 2, busy: 0 } } });
    });

    it('counts a lambda that is still starting', async () => {
      await start({ limit: 0 });
      const { getLambdaStats } = require(path.join(build, 'index.js'));

      const response = fetch(`${baseUrl}/`);
      // the request has to arrive first, the lambda announces itself some time after it was started
      for (let waited = 0; getLambdaStats().starting === 0 && waited < 3000; waited += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }

      expect(getLambdaStats()).toMatchObject({ lambdas: 1, starting: 1 });
      await response;
    });
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
