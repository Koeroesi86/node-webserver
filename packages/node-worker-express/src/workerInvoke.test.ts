import { ChildProcess, fork } from 'child_process';
import crypto from 'crypto';
import fsSync from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import { WORKER_EVENT } from './constants';

/** a worker for each behaviour the protocol has to handle, selected by the path of the request */
const workerSource = `
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readBody = async (event) => {
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of event.bodyStream) {
    hash.update(chunk);
    size += chunk.length;
  }
  return JSON.stringify({ size, sha256: hash.digest('hex') });
};
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
  if (event.path === '/has-stream') return callback({ statusCode: 200, headers: {}, body: await readBody(event), isBase64Encoded: false });
  if (event.path === '/metrics') {
    const metrics = await event.getMetrics();
    return callback({ statusCode: 200, headers: {}, body: JSON.stringify(metrics), isBase64Encoded: false });
  }
  if (event.path === '/metrics-twice') {
    const [first, second] = await Promise.all([event.getMetrics(), event.getMetrics()]);
    return callback({ statusCode: 200, headers: {}, body: JSON.stringify([first.uptimeSeconds, second.uptimeSeconds]), isBase64Encoded: false });
  }
  if (event.path === '/upload') return callback({ statusCode: 200, headers: {}, body: await readBody(event), isBase64Encoded: false });
  if (event.path === '/upload-late') {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return callback({ statusCode: 200, headers: {}, body: await readBody(event), isBase64Encoded: false });
  }
  if (event.path === '/upload-ignored') return callback({ statusCode: 413, headers: {}, body: 'too large', isBase64Encoded: false });
  if (event.path === '/upload-catches') {
    try {
      await readBody(event);
    } catch (error) {
      fs.writeFileSync(path.join(event.rootPath, 'upload-error'), error.message);
    }
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

  const send = (type: string, requestId: string, requestPath = '/', hasBody = false, inlineBody?: Buffer) =>
    child.send({
      type,
      requestId,
      event: {
        path: requestPath,
        rootPath: folder,
        headers: {},
        ...(hasBody && { hasBody: true }),
        ...(inlineBody !== undefined && { inlineBody: inlineBody.toString('base64') }),
      },
    });
  /** a part of a streamed request body, no argument ends it */
  const sendPart = (requestId: string, bytes?: Buffer) =>
    child.send({
      type: WORKER_EVENT.REQUEST_BODY,
      requestId,
      event: bytes === undefined ? { body: null, isBase64Encoded: false } : { body: bytes.toString('base64'), isBase64Encoded: true },
    });
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

  describe('streamed request bodies', () => {
    const answerOf = (requestId: string) => JSON.parse(of(requestId, WORKER_EVENT.RESPONSE)[0].event.body);
    const acknowledgements = (requestId: string) => of(requestId, WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE).length;

    it('gives every request a stream, an empty one when it has no body', async () => {
      send(WORKER_EVENT.REQUEST, 'plain', '/has-stream');
      send(WORKER_EVENT.REQUEST, 'streamed', '/has-stream', true);
      sendPart('streamed', Buffer.from('hello'));
      sendPart('streamed');

      await until(() => of('plain', WORKER_EVENT.RESPONSE).length === 1 && of('streamed', WORKER_EVENT.RESPONSE).length === 1);

      expect(answerOf('plain').size).toBe(0);
      expect(answerOf('streamed').size).toBe(5);
    });

    it('delivers the parts of the body in order and unchanged', async () => {
      const parts = Array.from({ length: 6 }, (_, index) => crypto.randomBytes(1000 + index));
      send(WORKER_EVENT.REQUEST, 'a', '/upload', true);

      parts.forEach((part) => sendPart('a', part));
      sendPart('a');

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);
      expect(answerOf('a')).toEqual({
        size: Buffer.concat(parts).length,
        sha256: crypto.createHash('sha256').update(Buffer.concat(parts)).digest('hex'),
      });
    });

    it('acknowledges small parts right away', async () => {
      send(WORKER_EVENT.REQUEST, 'a', '/upload', true);

      [1, 2, 3].forEach(() => sendPart('a', Buffer.alloc(100)));

      await until(() => acknowledgements('a') === 3);
    });

    it('acknowledges a part only once the worker has room for it', async () => {
      send(WORKER_EVENT.REQUEST, 'a', '/upload-late', true);

      [1, 2, 3].forEach(() => sendPart('a', Buffer.alloc(70000)));
      await settle();
      expect(acknowledgements('a')).toBe(0);

      // the worker starts reading after a while
      await until(() => acknowledgements('a') === 3);
    });

    it('ends the stream of the worker with an error when the request is aborted', async () => {
      send(WORKER_EVENT.REQUEST, 'a', '/upload-catches', true);
      sendPart('a', Buffer.alloc(10));
      await settle();

      child.send({ type: WORKER_EVENT.REQUEST_ABORT, requestId: 'a' });

      const marker = path.join(folder, 'upload-error');
      await until(() => fsSync.existsSync(marker));
      expect(await fs.readFile(marker, 'utf8')).toBe('The request was aborted.');
    });

    it('survives an abort while it is not reading the body', async () => {
      send(WORKER_EVENT.REQUEST, 'a', '/upload-late', true);
      sendPart('a', Buffer.alloc(10));

      child.send({ type: WORKER_EVENT.REQUEST_ABORT, requestId: 'a' });
      await settle();
      send(WORKER_EVENT.REQUEST, 'b', '/plain');

      await until(() => of('b', WORKER_EVENT.RESPONSE).length === 1);
    });

    it('drops the parts that arrive after the worker answered', async () => {
      send(WORKER_EVENT.REQUEST, 'a', '/upload-ignored', true);
      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      sendPart('a', Buffer.alloc(100));
      sendPart('a');
      await settle();

      expect(of('a').map(({ type }) => type)).toEqual([WORKER_EVENT.RESPONSE]);
    });
  });

  describe('a body that came with the request', () => {
    const answerOf = (requestId: string) => JSON.parse(of(requestId, WORKER_EVENT.RESPONSE)[0].event.body);
    const sha256 = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

    it('is what the worker reads from the stream, without any part after the request', async () => {
      const body = Buffer.from('hello inline world');
      send(WORKER_EVENT.REQUEST, 'a', '/upload', false, body);

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      expect(answerOf('a')).toEqual({ size: body.length, sha256: sha256(body) });
    });

    it('keeps every byte', async () => {
      const body = Buffer.from(Array.from({ length: 256 }, (_, value) => value));
      send(WORKER_EVENT.REQUEST, 'a', '/upload', false, body);

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      expect(answerOf('a')).toEqual({ size: 256, sha256: sha256(body) });
    });

    it('is empty when it has no bytes', async () => {
      send(WORKER_EVENT.REQUEST, 'a', '/upload', false, Buffer.alloc(0));

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      expect(answerOf('a').size).toBe(0);
    });

    it('is read whole when it is a couple of hundred kilobytes', async () => {
      const body = crypto.randomBytes(200 * 1024);
      send(WORKER_EVENT.REQUEST, 'a', '/upload', false, body);

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      expect(answerOf('a')).toEqual({ size: body.length, sha256: sha256(body) });
    });

    it('is not acknowledged, as there are no parts, and parts that arrive for the request anyway are left alone', async () => {
      const body = Buffer.from('inline');
      send(WORKER_EVENT.REQUEST, 'a', '/upload-late', false, body);
      sendPart('a', Buffer.alloc(100));
      sendPart('a');

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      expect(answerOf('a').size).toBe(body.length);
      expect(of('a', WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE)).toHaveLength(0);
    });

    it('keeps the bodies of requests that run at the same time apart', async () => {
      const bodies = ['one', 'two two', 'three three three'].map((text) => Buffer.from(text));
      bodies.forEach((body, index) => send(WORKER_EVENT.REQUEST, `r${index}`, '/upload', false, body));

      await until(() => bodies.every((_, index) => of(`r${index}`, WORKER_EVENT.RESPONSE).length === 1));

      bodies.forEach((body, index) => expect(answerOf(`r${index}`)).toEqual({ size: body.length, sha256: sha256(body) }));
    });
  });

  describe('metrics', () => {
    /** plays the server: answers every question of a worker for metrics with the next of the given uptimes */
    const serveMetrics = (...uptimes: number[]) => {
      let answered = 0;
      const timer = setInterval(() => {
        const asked = received.filter(({ type }) => type === WORKER_EVENT.METRICS_REQUEST);
        asked.slice(answered).forEach(({ requestId }) => {
          child.send({ type: WORKER_EVENT.METRICS, requestId, event: { uptimeSeconds: uptimes[answered] } });
          answered += 1;
        });
      }, 5);

      return () => clearInterval(timer);
    };

    it('gives the worker the metrics of the server on request', async () => {
      const stop = serveMetrics(42);
      send(WORKER_EVENT.REQUEST, 'a', '/metrics');

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      expect(JSON.parse(of('a', WORKER_EVENT.RESPONSE)[0].event.body)).toEqual({ uptimeSeconds: 42 });
      expect(of('a', WORKER_EVENT.METRICS_REQUEST)).toHaveLength(1);
      stop();
    });

    it('answers the questions of one request in the order they were asked', async () => {
      const stop = serveMetrics(1, 2);
      send(WORKER_EVENT.REQUEST, 'a', '/metrics-twice');

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      expect(JSON.parse(of('a', WORKER_EVENT.RESPONSE)[0].event.body)).toEqual([1, 2]);
      stop();
    });

    it('does not ask for metrics unless the worker does', async () => {
      send(WORKER_EVENT.REQUEST, 'a', '/plain');

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);
      await settle();

      expect(received.filter(({ type }) => type === WORKER_EVENT.METRICS_REQUEST)).toHaveLength(0);
    });
  });
});
