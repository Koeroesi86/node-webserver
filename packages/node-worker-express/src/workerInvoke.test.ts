import { ChildProcess, fork } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import { WORKER_EVENT } from './constants';

/** a worker for each behaviour the protocol has to handle, selected by the path of the request */
const workerSource = `
const fs = require('fs');
const path = require('path');
const part = (body) => ({ statusCode: 200, headers: {}, emit: true, body, isBase64Encoded: false });

module.exports = async (event, callback) => {
  if (event.path === '/plain') return callback({ statusCode: 200, headers: {}, body: 'plain', isBase64Encoded: false });
  if (event.path === '/throws') throw new Error('sync failure');
  if (event.path === '/rejects') throw await Promise.reject(new Error('async failure'));
  if (event.path === '/answers-then-throws') {
    callback({ statusCode: 200, headers: {}, body: 'answered', isBase64Encoded: false });
    throw new Error('late failure');
  }
  if (event.path === '/stream') {
    for (const body of ['one', 'two', 'three']) await callback(part(body));
    await callback(part(null));
    return;
  }
  if (event.path === '/stops-when-aborted') {
    let index = 0;
    while (await callback(part('part ' + index++)));
    fs.writeFileSync(path.join(event.rootPath, 'stopped'), String(index));
  }
};
`;

describe('workerInvoke', () => {
  let folder: string;
  let child: ChildProcess;
  let received: Array<{ type: string; requestId: string; event?: { statusCode: number; body: string | null } }>;

  beforeAll(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'worker-invoke-'));
    await fs.mkdir(path.join(folder, 'constants'));
    const compile = (source: string) =>
      ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    await fs.writeFile(path.join(folder, 'workerInvoke.js'), compile(await fs.readFile(path.join(__dirname, 'workerInvoke.ts'), 'utf8')));
    await fs.writeFile(path.join(folder, 'constants', 'index.js'), compile(await fs.readFile(path.join(__dirname, 'constants', 'index.ts'), 'utf8')));
    await fs.writeFile(path.join(folder, 'worker.js'), workerSource);
  });

  afterAll(() => fs.rm(folder, { recursive: true, force: true }));

  beforeEach(() => {
    received = [];
    child = fork(path.join(folder, 'workerInvoke.js'), [path.join(folder, 'worker.js')], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    child.on('message', (message: (typeof received)[number]) => received.push(message));
    child.stderr.resume();
  });

  afterEach(() => {
    child.kill();
  });

  const send = (type: string, requestId: string, requestPath = '/') =>
    child.send({ type, requestId, event: { path: requestPath, rootPath: folder, headers: {} } });
  const until = async (condition: () => boolean) => {
    for (let waited = 0; !condition() && waited < 3000; waited += 10) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(condition()).toBe(true);
  };
  const of = (requestId: string, type?: string) =>
    received.filter((message) => message.requestId === requestId && (type === undefined || message.type === type));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  it('passes the response of the worker on', async () => {
    send(WORKER_EVENT.REQUEST, 'a', '/plain');

    await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

    expect(of('a', WORKER_EVENT.RESPONSE)[0].event).toMatchObject({ statusCode: 200, body: 'plain' });
  });

  it('sends nothing else for a plain request, as every message is a write to the pipe of the parent', async () => {
    send(WORKER_EVENT.REQUEST, 'a', '/plain');

    await until(() => of('a').length >= 1);
    await settle();

    expect(of('a').map(({ type }) => type)).toEqual([WORKER_EVENT.RESPONSE]);
  });

  it.each(['/throws', '/rejects'])('answers 500 when the worker fails on %s', async (requestPath) => {
    send(WORKER_EVENT.REQUEST, 'a', requestPath);

    await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

    expect(of('a', WORKER_EVENT.RESPONSE)[0].event).toMatchObject({ statusCode: 500 });
  });

  it('does not answer twice when the worker fails after it answered', async () => {
    send(WORKER_EVENT.REQUEST, 'a', '/answers-then-throws');

    await settle();

    expect(of('a', WORKER_EVENT.RESPONSE)).toHaveLength(1);
    expect(of('a', WORKER_EVENT.RESPONSE)[0].event).toMatchObject({ statusCode: 200, body: 'answered' });
  });

  it('keeps working after a worker failed', async () => {
    send(WORKER_EVENT.REQUEST, 'a', '/throws');
    send(WORKER_EVENT.REQUEST, 'b', '/plain');

    await until(() => of('b', WORKER_EVENT.RESPONSE).length === 1);
  });

  it('streams a part only after the previous one was acknowledged', async () => {
    send(WORKER_EVENT.REQUEST, 'a', '/stream');

    await until(() => of('a', WORKER_EVENT.RESPONSE_EMIT).length === 1);
    await settle();
    expect(of('a', WORKER_EVENT.RESPONSE_EMIT)).toHaveLength(1);

    child.send({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId: 'a' });
    await until(() => of('a', WORKER_EVENT.RESPONSE_EMIT).length === 2);
    await settle();
    expect(of('a', WORKER_EVENT.RESPONSE_EMIT)).toHaveLength(2);
  });

  it('ends a stream with a part without a body', async () => {
    send(WORKER_EVENT.REQUEST, 'a', '/stream');

    for (let acknowledged = 0; acknowledged < 4; acknowledged += 1) {
      await until(() => of('a', WORKER_EVENT.RESPONSE_EMIT).length === acknowledged + 1);
      child.send({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId: 'a' });
    }
    await settle();

    expect(of('a', WORKER_EVENT.RESPONSE_EMIT).map(({ event }) => event.body)).toEqual(['one', 'two', 'three', null]);
  });

  it('keeps the acknowledgements of requests apart', async () => {
    send(WORKER_EVENT.REQUEST, 'a', '/stream');
    send(WORKER_EVENT.REQUEST, 'b', '/stream');
    await until(() => of('a', WORKER_EVENT.RESPONSE_EMIT).length === 1 && of('b', WORKER_EVENT.RESPONSE_EMIT).length === 1);

    child.send({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId: 'b' });

    await until(() => of('b', WORKER_EVENT.RESPONSE_EMIT).length === 2);
    await settle();
    expect(of('a', WORKER_EVENT.RESPONSE_EMIT)).toHaveLength(1);
  });

  it('lets a streaming worker know when the client is gone', async () => {
    send(WORKER_EVENT.REQUEST, 'a', '/stops-when-aborted');
    await until(() => of('a', WORKER_EVENT.RESPONSE_EMIT).length === 1);

    child.send({ type: WORKER_EVENT.REQUEST_ABORT, requestId: 'a' });

    await until(() => child.connected);
    const marker = path.join(folder, 'stopped');
    for (let waited = 0; waited < 3000; waited += 10) {
      if (
        await fs.access(marker).then(
          () => true,
          () => false
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(await fs.readFile(marker, 'utf8')).toBe('1');
    expect(of('a', WORKER_EVENT.RESPONSE_EMIT)).toHaveLength(1);
  });

  it('exits when its parent goes away', async () => {
    const exited = new Promise((resolve) => child.once('exit', resolve));

    child.disconnect();

    await expect(Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve('still running'), 3000))])).resolves.not.toBe('still running');
  });
});
