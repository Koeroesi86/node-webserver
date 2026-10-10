import childProcess, { ChildProcess, fork } from 'child_process';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import type { HttpMiddlewareOptions } from '../types';

/** the lambdas of the tests, selected by the path of the request */
const lambdaSource = `
// the pool keeps its lambdas running, so every one of them reports itself to be stopped after the tests, when it is allowed to write there
try { require('fs').appendFileSync(process.env.PID_FILE, process.pid + '\\n'); } catch {}

exports.handler = (event, context, callback) => {
  const respond = () => callback(null, { statusCode: 200, headers: { 'x-pid': String(process.pid) }, body: 'echo ' + event.path });
  if (event.path === '/exit') process.exit(1);
  if (event.path === '/throw') throw new Error('the secret of the handler');
  if (event.path === '/error') return callback(new Error('the secret of the handler'));
  if (event.path === '/never') return;
  if (event.path === '/no-status') return callback(null, {});
  if (event.path === '/object-body') return callback(null, { statusCode: 200, body: { an: 'object' } });
  if (event.path === '/tmpdir') return callback(null, { statusCode: 200, body: require('os').tmpdir() });
  if (event.path === '/write-tmp') {
    require('fs').writeFileSync(require('os').tmpdir() + '/note', 'kept');
    return callback(null, { statusCode: 200, body: 'written' });
  }
  if (event.path === '/read-tmp') {
    const note = require('fs').existsSync(require('os').tmpdir() + '/note') ? require('fs').readFileSync(require('os').tmpdir() + '/note', 'utf8') : 'none';
    return callback(null, { statusCode: 200, body: note });
  }
  if (event.path === '/write-code') {
    try {
      require('fs').writeFileSync(__dirname + '/forbidden', 'x');
      return callback(null, { statusCode: 200, body: 'written' });
    } catch (error) {
      return callback(null, { statusCode: 200, body: 'denied ' + error.code });
    }
  }
  if (event.path === '/event') return callback(null, { statusCode: 200, body: JSON.stringify(event) });
  if (event.path === '/env') return callback(null, { statusCode: 200, body: JSON.stringify(process.env) });
  if (event.path.startsWith('/slow')) return setTimeout(respond, 100);
  if (event.path === '/hold') return setTimeout(respond, 400);
  // answers once the number of lambdas in the path (/gather/8) has got a request, so that no lambda is free for another request before that (3 seconds at most)
  if (event.path.startsWith('/gather/')) {
    const { appendFileSync, readFileSync } = require('fs');
    const file = process.env.PID_FILE + '.gather';
    appendFileSync(file, process.pid + '\\n');
    const wait = (waited) => (readFileSync(file, 'utf8').trim().split('\\n').length >= Number(event.path.split('/')[2]) || waited >= 3000 ? respond() : setTimeout(() => wait(waited + 10), 10));
    return wait(0);
  }
  respond();
};

exports.asyncHandler = async (event, context) => ({
  statusCode: 200,
  body: JSON.stringify({ id: context.awsRequestId, requestId: event.requestContext.requestId, remaining: context.getRemainingTimeInMillis(), name: context.functionName }),
});
exports.controllers = { users: { get(event, context, callback) { callback(null, { statusCode: 200, body: 'this is ' + (this === exports.controllers.users) }); } } };
exports.headers = (event, context, callback) => callback(null, { statusCode: 200, headers: { 'X-A': '1' }, multiValueHeaders: { 'x-a': ['2'] }, cookies: ['a=1', 'b=2'] });
exports.other = (event, context, callback) => callback(null, { statusCode: 200, headers: { 'x-pid': String(process.pid) }, body: 'other ' + event.path });
`;

/** an ES module that loads asynchronously, which AWS allows */
const esmSource = `
import { appendFileSync } from 'node:fs';
try { appendFileSync(process.env.PID_FILE, process.pid + '\\n'); } catch {}
await Promise.resolve();
export const handler = async (event) => ({ statusCode: 200, body: 'esm ' + event.path });
`;

/** a lambda whose module never finishes loading */
const hangingSource = `
require('fs').appendFileSync(process.env.PID_FILE, process.pid + '\\n');
for (;;) {}
`;

/** starts a server with the middleware in a process of its own, to see what happens to the lambdas when it is killed */
const parentSource = `
const http = require('http');
const { httpMiddleware } = require('./index');
const server = http.createServer(httpMiddleware({ lambdaPath: process.argv[2], communication: { type: 'ipc' }, env: { PID_FILE: process.env.PID_FILE } }));
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
        // node16 keeps `import()` as it is, which is how the lambda loads its module, CommonJS or ES
        compilerOptions: { module: ts.ModuleKind.Node16, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true },
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
    await fs.writeFile(path.join(build, 'hanging.js'), hangingSource);
    await fs.writeFile(path.join(build, 'esm.mjs'), esmSource);
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
    // the lambdas get only the environment they are given
    server = http.createServer(httpMiddleware({ lambdaPath, communication: { type: 'ipc' }, env: { PID_FILE: pidFile }, ...options }));
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
      // the storage of a request lets go of the lambda after the response was handed over
      const requestAndSettle = async (request: number) => {
        await (await fetch(`${baseUrl}/${request}`)).text();
        await new Promise((resolve) => setTimeout(resolve, 50));
      };
      await requestAndSettle(0);
      const lambda = spawn.mock.results[0].value as ChildProcess;
      const [messageListeners, closeListeners] = [lambda.listenerCount('message'), lambda.listenerCount('close')];

      for (let request = 1; request < 30; request += 1) {
        await (await fetch(`${baseUrl}/${request}`)).text();
      }
      await requestAndSettle(30);

      expect(spawn).toHaveBeenCalledTimes(1);
      expect(lambda.listenerCount('message')).toBe(messageListeners);
      expect(lambda.listenerCount('close')).toBe(closeListeners);
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

  it('answers 502 instead of waiting when the lambda cannot start', async () => {
    await start({ lambdaPath: path.join(build, 'missing.js') });

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(502);
  });

  it('answers 502 and stops a lambda that does not start in time', async () => {
    // it has to be able to write its process id to the file, to be found afterwards
    await start({ lambdaPath: path.join(build, 'hanging.js'), startTimeout: 300, restrictFileSystem: false });

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(502);
    const pids = (await fs.readFile(pidFile, 'utf8')).trim().split('\n').map(Number);
    const hanging = pids[pids.length - 1];
    for (let waited = 0; processExists(hanging) && waited < 3000; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(processExists(hanging)).toBe(false);
  });

  it('answers 504 and replaces a lambda that does not answer in time', async () => {
    await start({ limit: 1, timeout: 300 });

    const timedOut = await fetch(`${baseUrl}/never`);
    // the only lambda there may be was stopped, so a new one has to answer
    const next = await fetch(`${baseUrl}/after`);

    expect(timedOut.status).toBe(504);
    expect(await timedOut.json()).toEqual({ message: 'Endpoint request timed out' });
    expect(await next.text()).toBe('echo /after');
  });

  it.each([['/error'], ['/throw']])('answers 502 without the details of the error when the handler fails (%s), and keeps serving', async (requestPath) => {
    await start({ limit: 1 });

    const failed = await fetch(`${baseUrl}${requestPath}`);
    const next = await fetch(`${baseUrl}/after`);

    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ message: 'Internal server error' });
    expect(await next.text()).toBe('echo /after');
  });

  it.each([['/no-status'], ['/object-body']])('answers 502 to a malformed response (%s)', async (requestPath) => {
    await start();

    const response = await fetch(`${baseUrl}${requestPath}`);

    expect(response.status).toBe(502);
  });

  it('runs the handler that it was given, also when another one of the same file runs already', async () => {
    await start();
    const { httpMiddleware } = require(path.join(build, 'index.js'));
    const other = http.createServer(httpMiddleware({ lambdaPath, handlerKey: 'other', communication: { type: 'ipc' }, env: { PID_FILE: pidFile } }));
    await new Promise<void>((resolve) => other.listen(0, resolve));

    try {
      expect(await (await fetch(`${baseUrl}/`)).text()).toBe('echo /');
      expect(await (await fetch(`http://localhost:${(other.address() as { port: number }).port}/`)).text()).toBe('other /');
    } finally {
      other.closeAllConnections();
      await new Promise((resolve) => other.close(resolve));
    }
  });

  it('gives the lambda its own environment, not the one of the server', async () => {
    process.env.SECRET_OF_THE_SERVER = 'secret';
    try {
      await start({ env: { PID_FILE: pidFile, TABLE: 'users' } });

      const env = await (await fetch(`${baseUrl}/env`)).json();

      expect(env).toMatchObject({ TABLE: 'users', AWS_LAMBDA_FUNCTION_NAME: 'lambda', _HANDLER: 'lambda.handler' });
      expect(env).not.toHaveProperty('SECRET_OF_THE_SERVER');
      expect(env).not.toHaveProperty('LAMBDA');
    } finally {
      delete process.env.SECRET_OF_THE_SERVER;
    }
  });

  describe('storage', () => {
    const waitUntil = async (condition: () => boolean) => {
      for (let waited = 0; !condition() && waited < 5000; waited += 20) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };

    it('gives every lambda a /tmp of its own, which stays while the lambda runs', async () => {
      await start({ limit: 1 });

      await fetch(`${baseUrl}/write-tmp`);
      const kept = await (await fetch(`${baseUrl}/read-tmp`)).text();
      const tmpdir = await (await fetch(`${baseUrl}/tmpdir`)).text();

      expect(kept).toBe('kept');
      expect(path.basename(path.dirname(tmpdir))).toMatch(new RegExp(`^node-lambda-${process.pid}-`));
      expect(path.basename(tmpdir)).toBe('tmp');
    });

    it('does not share /tmp between lambdas', async () => {
      await start({ limit: 0 });

      const folders = await Promise.all([1, 2, 3].map(async () => (await fetch(`${baseUrl}/slow/tmpdir`)).headers.get('x-pid')));
      await fetch(`${baseUrl}/write-tmp`);
      const reads = await Promise.all([1, 2, 3].map(async () => (await fetch(`${baseUrl}/slow/read-tmp`)).text()));

      expect(new Set(folders).size).toBe(3);
      expect(reads.filter((text) => text === 'echo /slow/read-tmp')).toHaveLength(3);
    });

    it('removes the folder of a lambda when it exits', async () => {
      await start({ limit: 1 });
      const tmpdir = await (await fetch(`${baseUrl}/tmpdir`)).text();
      expect(existsSync(tmpdir)).toBe(true);

      await fetch(`${baseUrl}/exit`);
      await waitUntil(() => !existsSync(tmpdir));

      expect(existsSync(tmpdir)).toBe(false);
    });

    it('lets a lambda write nowhere but in its own folder, like the code of a function on AWS', async () => {
      await start();

      expect(await (await fetch(`${baseUrl}/write-code`)).text()).toBe('denied ERR_ACCESS_DENIED');
    });

    it('lets a lambda write anywhere when the file system is not restricted', async () => {
      await start({ restrictFileSystem: false });

      expect(await (await fetch(`${baseUrl}/write-code`)).text()).toBe('written');
    });

    it('keeps the requests and responses of the file communication in a folder of the lambda, and answers', async () => {
      await start({ communication: { type: 'file' } });

      const response = await fetch(`${baseUrl}/hello`);

      expect(await response.text()).toBe('echo /hello');
    });
  });

  describe('handlers', () => {
    it('answers with what an async handler returns, and gives it the context of AWS', async () => {
      await start({ handlerKey: 'asyncHandler', timeout: 60000 });

      const body: { id: string; requestId: string; remaining: number } = JSON.parse(await (await fetch(`${baseUrl}/`)).text());

      expect(body).toMatchObject({ name: 'lambda', id: body.requestId });
      expect(body.remaining).toBeGreaterThan(50000);
      expect(body.remaining).toBeLessThanOrEqual(60000);
    });

    it('calls a nested handler on what holds it', async () => {
      await start({ handlerKey: 'controllers.users.get' });

      expect(await (await fetch(`${baseUrl}/`)).text()).toBe('this is true');
    });

    it('loads an ES module with top-level await', async () => {
      await start({ lambdaPath: path.join(build, 'esm.mjs') });

      expect(await (await fetch(`${baseUrl}/hello`)).text()).toBe('esm /hello');
    });

    it('answers 502 instead of waiting when the handler does not exist', async () => {
      await start({ handlerKey: 'missing.handler' });

      expect((await fetch(`${baseUrl}/`)).status).toBe(502);
    });

    it('writes the headers of several values and the cookies', async () => {
      await start({ handlerKey: 'headers' });

      const response = await fetch(`${baseUrl}/`);

      expect(response.headers.get('x-a')).toBe('1, 2');
      expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    });
  });

  describe('request', () => {
    /** a request with the exact header names given, which fetch does not keep */
    const send = (options: http.RequestOptions, body?: Buffer | string) =>
      new Promise<{ status: number; text: string }>((resolve, reject) => {
        const request = http.request(`${baseUrl}${options.path ?? '/event'}`, { method: 'GET', ...options }, (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
        });
        request.on('error', reject);
        request.end(body);
      });

    it('gives the lambda the body of the request', async () => {
      await start();

      const { text } = await send({ method: 'POST' }, 'hello');

      expect(JSON.parse(text)).toMatchObject({ httpMethod: 'POST', body: 'hello', isBase64Encoded: false });
    });

    it('passes a body that is not valid UTF-8 as base64', async () => {
      await start();

      const { text } = await send({ method: 'PUT' }, Buffer.from([0, 1, 2, 255]));

      expect(JSON.parse(text)).toMatchObject({ body: Buffer.from([0, 1, 2, 255]).toString('base64'), isBase64Encoded: true });
    });

    it('has a null body and null parameters when the request has none', async () => {
      await start();

      const { text } = await send({});

      expect(JSON.parse(text)).toMatchObject({ body: null, queryStringParameters: null, multiValueQueryStringParameters: null, isBase64Encoded: false });
    });

    it('passes the query and the headers the way API Gateway does', async () => {
      await start();

      const { text } = await send({ path: '/event?a=1&a=2&b=3', headers: { 'X-Custom-Header': ['one', 'two'] } });

      expect(JSON.parse(text)).toMatchObject({
        queryStringParameters: { a: '2', b: '3' },
        multiValueQueryStringParameters: { a: ['1', '2'], b: ['3'] },
        headers: { 'X-Custom-Header': 'two' },
        multiValueHeaders: { 'X-Custom-Header': ['one', 'two'] },
      });
    });

    it('answers 413 to a body over the limit, also when it is not announced, and keeps serving', async () => {
      await start({ limitRequestBody: 10 });

      const announced = await send({ method: 'POST' }, 'x'.repeat(100));
      const chunked = await send({ method: 'POST', headers: { 'Transfer-Encoding': 'chunked' } }, 'x'.repeat(100));
      const next = await send({ method: 'POST' }, 'small');

      expect([announced.status, chunked.status, next.status]).toEqual([413, 413, 200]);
      expect(JSON.parse(announced.text)).toEqual({ message: 'Request Entity Too Large' });
    });

    it('does not hold a lambda while the body is still coming in', async () => {
      await start({ limit: 1, acquireTimeout: 100 });
      const slowUpload = http.request(`${baseUrl}/event`, { method: 'POST', headers: { 'Content-Length': '10' } });
      slowUpload.on('error', () => undefined);
      slowUpload.write('12345');

      try {
        expect((await send({ path: '/hello' })).status).toBe(200);
      } finally {
        slowUpload.destroy();
      }
    });
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
      const refused = responses.find(({ status }) => status === 503);
      expect(await refused?.json()).toEqual({ message: 'Service Unavailable' });
    });

    it('gives every middleware a limit of its own', async () => {
      const { httpMiddleware } = load();
      const create = () =>
        http.createServer(httpMiddleware({ lambdaPath, limit: 1, acquireTimeout: 50, communication: { type: 'ipc' }, env: { PID_FILE: pidFile } }));
      const servers = [create(), create()];
      await Promise.all(servers.map((instance) => new Promise<void>((resolve) => instance.listen(0, resolve))));

      try {
        // both hold their lambda for longer than the wait, so they only both get one when the limits are apart
        const responses = await Promise.all(servers.map((instance) => fetch(`http://localhost:${(instance.address() as { port: number }).port}/hold`)));

        expect(responses.map(({ status }) => status)).toEqual([200, 200]);
      } finally {
        servers.forEach((instance) => instance.closeAllConnections());
        await Promise.all(servers.map((instance) => new Promise((resolve) => instance.close(resolve))));
      }
    });

    it('serves the requests that wait in the order they came in', async () => {
      await start({ limit: 1 });
      const arrived: number[] = [];
      server.on('request', () => arrived.push(arrived.length + 1));
      const answered: string[] = [];

      const responses = [];
      for (let index = 1; index <= 4; index += 1) {
        responses.push(fetch(`${baseUrl}/slow/${index}`).then(async (response) => answered.push(await response.text())));
        // the next one is sent when this one has reached the server, so that the order of arrival is known
        for (; arrived.length < index; ) await new Promise((resolve) => setImmediate(resolve));
      }
      await Promise.all(responses);

      expect(answered).toEqual([1, 2, 3, 4].map((index) => `echo /slow/${index}`));
    });

    it('gives a waiting request the lambda of a request that crashed it', async () => {
      await start({ limit: 1 });

      const responses = await Promise.all([fetch(`${baseUrl}/exit`), fetch(`${baseUrl}/after`)]);

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 502]);
    });

    it('lets a request leave the line when its client goes away', async () => {
      await start({ limit: 1 });
      const { getLambdaStats } = require(path.join(build, 'index.js'));
      const holding = fetch(`${baseUrl}/hold`);
      const leaving = new AbortController();
      const gone = fetch(`${baseUrl}/after`, { signal: leaving.signal }).catch(() => undefined);
      for (let waited = 0; getLambdaStats().waiting < 1 && waited < 3000; waited += 10) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(getLambdaStats().waiting).toBe(1);

      leaving.abort();
      await gone;
      for (let waited = 0; getLambdaStats().waiting > 0 && waited < 3000; waited += 10) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(getLambdaStats()).toMatchObject({ waiting: 0, abandoned: 1 });
      expect((await holding).status).toBe(200);
      // the lambda was not taken by the request that left
      expect(await (await fetch(`${baseUrl}/next`)).text()).toBe('echo /next');
    });

    it('allows as many lambdas as there are CPU cores by default', async () => {
      await start();

      const { statuses, pids } = await pidsOf(40);

      expect(statuses).toEqual(Array(40).fill(200));
      expect(new Set(pids).size).toBeLessThanOrEqual(os.availableParallelism());
    });

    it('has no limit when it is 0', async () => {
      // the lambdas meet in a file next to the code, which they are not allowed to write to otherwise
      await start({ limit: 0, restrictFileSystem: false });

      const { pids } = await pidsOf(8, '/gather/8');

      expect(new Set(pids).size).toBe(8);
    });
  });

  describe('stats', () => {
    it('is empty before a lambda was started', async () => {
      const { getLambdaStats } = load();

      expect(getLambdaStats()).toEqual({ lambdas: 0, starting: 0, busy: 0, waiting: 0, abandoned: 0, files: {} });
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

  it('starts a storage driver once, as starting it again would drop what the requests of the middlewares before have stored', async () => {
    const driver = path.join(build, 'counting-driver.js');
    const starts = path.join(build, 'starts');
    await fs.writeFile(driver, `module.exports = class { static start() { require('fs').appendFileSync(${JSON.stringify(starts)}, 'x'); } };`);
    const { httpMiddleware } = load();

    httpMiddleware({ lambdaPath, communication: { type: 'counting', path: driver } });
    httpMiddleware({ lambdaPath, communication: { type: 'counting', path: driver } });

    expect(await fs.readFile(starts, 'utf8')).toBe('x');
  });

  it('stops its lambdas when it is closed', async () => {
    const { httpMiddleware } = load();
    const middleware = httpMiddleware({ lambdaPath, communication: { type: 'ipc' } });
    server = http.createServer(middleware);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const pid = Number((await fetch(`http://localhost:${(server.address() as { port: number }).port}/`)).headers.get('x-pid'));

    middleware.close();

    for (let waited = 0; processExists(pid) && waited < 5000; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(processExists(pid)).toBe(false);
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
