import { ChildProcess, spawn } from 'child_process';
import crypto from 'crypto';
import fsSync from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Duplex } from 'stream';
import ts from 'typescript';
import { WORKER_EVENT } from './constants';
import createChannel from './utils/createChannel';
import type { Channel } from './utils/createChannel';
import type { ResponseMessage, WorkerInputEvent } from './types';
import type { ServerMetrics } from './utils/metrics';

/** what the worker sends for a request, the messages for websockets are not tested here */
type Received = { type: string; requestId: string; event?: ResponseMessage };

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
  if (event.path === '/binary') return callback({ statusCode: 200, headers: {}, body: Buffer.from(Array.from({ length: 256 }, (_, value) => value)).toString('base64'), isBase64Encoded: true });
  if (event.path === '/buffer') return callback({ statusCode: 200, headers: {}, body: Buffer.from('árvíztűrő'), isBase64Encoded: true });
  if (event.path === '/big') return callback({ statusCode: 200, headers: {}, body: Buffer.alloc(3 * 1024 * 1024, 7) });
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
  let channel: Channel<WorkerInputEvent>;
  let received: Received[];

  beforeAll(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'worker-invoke-'));
    await fs.mkdir(path.join(folder, 'constants'));
    await fs.mkdir(path.join(folder, 'utils'));
    const compile = (source: string) =>
      ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    // what the worker process loads, as the build puts it together
    await Promise.all(
      ['workerInvoke', 'constants/index', 'utils/createChannel', 'utils/frames'].map(async (file) =>
        fs.writeFile(path.join(folder, `${file}.js`), compile(await fs.readFile(path.join(__dirname, `${file}.ts`), 'utf8')))
      )
    );
    await fs.writeFile(path.join(folder, 'worker.js'), workerSource);
  });

  afterAll(() => fs.rm(folder, { recursive: true, force: true }));

  beforeEach(() => {
    received = [];
    // the channel is the fourth stdio, as the pool starts workers
    child = spawn(process.execPath, [path.join(folder, 'workerInvoke.js'), path.join(folder, 'worker.js')], { stdio: ['pipe', 'pipe', 'pipe', 'overlapped'] });
    const socket = child.stdio[3];
    if (!(socket instanceof Duplex)) throw new Error('The worker has no channel.');
    channel = createChannel<Received, WorkerInputEvent>(socket, (message) => received.push(message));
    child.stdout.resume();
    child.stderr.resume();
  });

  afterEach(() => {
    child.kill();
  });

  const send = (requestId: string, requestPath = '/', hasBody = false, inlineBody?: Buffer) =>
    channel.send({
      type: WORKER_EVENT.REQUEST,
      requestId,
      event: {
        httpMethod: 'GET',
        protocol: 'HTTP',
        path: requestPath,
        pathFragments: [],
        queryStringParameters: {},
        remoteAddress: '',
        rootPath: folder,
        headers: {},
        ...(hasBody && { hasBody: true }),
        ...(inlineBody !== undefined && { inlineBody: inlineBody.toString('base64') }),
      },
    });
  /** a part of a streamed request body, no argument ends it */
  const sendPart = (requestId: string, bytes: Buffer | null = null) => channel.send({ type: WORKER_EVENT.REQUEST_BODY, requestId, event: { body: bytes } });
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
    send('a', '/plain');

    await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

    expect(of('a', WORKER_EVENT.RESPONSE)[0].event).toMatchObject({ statusCode: 200, body: Buffer.from('plain') });
  });

  it('sends what the worker answers with as bytes, whichever way it gave them', async () => {
    send('binary', '/binary');
    send('buffer', '/buffer');

    await until(() => of('binary').length === 1 && of('buffer').length === 1);

    // a base64 body is decoded in the worker, so the server gets the bytes
    expect(of('binary')[0].event.body).toEqual(Buffer.from(Array.from({ length: 256 }, (_, value) => value)));
    expect(of('buffer')[0].event.body).toEqual(Buffer.from('árvíztűrő'));
    expect(of('binary')[0].event).not.toHaveProperty('isBase64Encoded');
  });

  it('sends a response of several megabytes whole', async () => {
    send('a', '/big');

    await until(() => of('a').length === 1);

    expect(Buffer.alloc(3 * 1024 * 1024, 7).equals(Buffer.from(of('a')[0].event.body))).toBe(true);
  });

  it('sends nothing else for a plain request, as every message is a write to the channel', async () => {
    send('a', '/plain');

    await until(() => of('a').length >= 1);
    await settle();

    expect(of('a').map(({ type }) => type)).toEqual([WORKER_EVENT.RESPONSE]);
  });

  it.each(['/throws', '/rejects'])('answers 500 when the worker fails on %s', async (requestPath) => {
    send('a', requestPath);

    await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

    expect(of('a', WORKER_EVENT.RESPONSE)[0].event).toMatchObject({ statusCode: 500 });
  });

  it('does not answer twice when the worker fails after it answered', async () => {
    send('a', '/answers-then-throws');

    // the answer comes first, and a second one would follow the failure
    await until(() => of('a', WORKER_EVENT.RESPONSE).length >= 1);
    await settle();

    expect(of('a', WORKER_EVENT.RESPONSE)).toHaveLength(1);
    expect(of('a', WORKER_EVENT.RESPONSE)[0].event).toMatchObject({ statusCode: 200, body: Buffer.from('answered') });
  });

  it('keeps working after a worker failed', async () => {
    send('a', '/throws');
    send('b', '/plain');

    await until(() => of('b', WORKER_EVENT.RESPONSE).length === 1);
  });

  it('streams a part only after the previous one was acknowledged', async () => {
    send('a', '/stream');

    await until(() => of('a', WORKER_EVENT.RESPONSE_EMIT).length === 1);
    await settle();
    expect(of('a', WORKER_EVENT.RESPONSE_EMIT)).toHaveLength(1);

    channel.send({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId: 'a' });
    await until(() => of('a', WORKER_EVENT.RESPONSE_EMIT).length === 2);
    await settle();
    expect(of('a', WORKER_EVENT.RESPONSE_EMIT)).toHaveLength(2);
  });

  it('ends a stream with a part without a body', async () => {
    send('a', '/stream');

    for (let acknowledged = 0; acknowledged < 4; acknowledged += 1) {
      await until(() => of('a', WORKER_EVENT.RESPONSE_EMIT).length === acknowledged + 1);
      channel.send({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId: 'a' });
    }
    await settle();

    expect(of('a', WORKER_EVENT.RESPONSE_EMIT).map(({ event }) => event.body)).toEqual([Buffer.from('one'), Buffer.from('two'), Buffer.from('three'), null]);
  });

  it('keeps the acknowledgements of requests apart', async () => {
    send('a', '/stream');
    send('b', '/stream');
    await until(() => of('a', WORKER_EVENT.RESPONSE_EMIT).length === 1 && of('b', WORKER_EVENT.RESPONSE_EMIT).length === 1);

    channel.send({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId: 'b' });

    await until(() => of('b', WORKER_EVENT.RESPONSE_EMIT).length === 2);
    await settle();
    expect(of('a', WORKER_EVENT.RESPONSE_EMIT)).toHaveLength(1);
  });

  it('lets a streaming worker know when the client is gone', async () => {
    send('a', '/stops-when-aborted');
    await until(() => of('a', WORKER_EVENT.RESPONSE_EMIT).length === 1);

    channel.send({ type: WORKER_EVENT.REQUEST_ABORT, requestId: 'a' });

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

    child.stdio[3].destroy();

    await expect(Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve('still running'), 3000))])).resolves.not.toBe('still running');
  });

  describe('streamed request bodies', () => {
    const answerOf = (requestId: string) => JSON.parse(of(requestId, WORKER_EVENT.RESPONSE)[0].event.body.toString());
    const acknowledgements = (requestId: string) => of(requestId, WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE).length;

    it('gives every request a stream, an empty one when it has no body', async () => {
      send('plain', '/has-stream');
      send('streamed', '/has-stream', true);
      sendPart('streamed', Buffer.from('hello'));
      sendPart('streamed');

      await until(() => of('plain', WORKER_EVENT.RESPONSE).length === 1 && of('streamed', WORKER_EVENT.RESPONSE).length === 1);

      expect(answerOf('plain').size).toBe(0);
      expect(answerOf('streamed').size).toBe(5);
    });

    it('delivers the parts of the body in order and unchanged', async () => {
      const parts = Array.from({ length: 6 }, (_, index) => crypto.randomBytes(1000 + index));
      send('a', '/upload', true);

      parts.forEach((part) => sendPart('a', part));
      sendPart('a');

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);
      expect(answerOf('a')).toEqual({
        size: Buffer.concat(parts).length,
        sha256: crypto.createHash('sha256').update(Buffer.concat(parts)).digest('hex'),
      });
    });

    it('acknowledges small parts right away', async () => {
      send('a', '/upload', true);

      [1, 2, 3].forEach(() => sendPart('a', Buffer.alloc(100)));

      await until(() => acknowledgements('a') === 3);
    });

    it('acknowledges a part only once the worker has room for it', async () => {
      send('a', '/upload-late', true);

      [1, 2, 3].forEach(() => sendPart('a', Buffer.alloc(70000)));
      await settle();
      expect(acknowledgements('a')).toBe(0);

      // the worker starts reading after a while
      await until(() => acknowledgements('a') === 3);
    });

    it('ends the stream of the worker with an error when the request is aborted', async () => {
      send('a', '/upload-catches', true);
      sendPart('a', Buffer.alloc(10));
      await settle();

      channel.send({ type: WORKER_EVENT.REQUEST_ABORT, requestId: 'a' });

      const marker = path.join(folder, 'upload-error');
      await until(() => fsSync.existsSync(marker));
      expect(await fs.readFile(marker, 'utf8')).toBe('The request was aborted.');
    });

    it('survives an abort while it is not reading the body', async () => {
      send('a', '/upload-late', true);
      sendPart('a', Buffer.alloc(10));

      channel.send({ type: WORKER_EVENT.REQUEST_ABORT, requestId: 'a' });
      await settle();
      send('b', '/plain');

      await until(() => of('b', WORKER_EVENT.RESPONSE).length === 1);
    });

    it('drops the parts that arrive after the worker answered', async () => {
      send('a', '/upload-ignored', true);
      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      sendPart('a', Buffer.alloc(100));
      sendPart('a');
      await settle();

      expect(of('a').map(({ type }) => type)).toEqual([WORKER_EVENT.RESPONSE]);
    });
  });

  describe('a body that came with the request', () => {
    const answerOf = (requestId: string) => JSON.parse(of(requestId, WORKER_EVENT.RESPONSE)[0].event.body.toString());
    const sha256 = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

    it('is what the worker reads from the stream, without any part after the request', async () => {
      const body = Buffer.from('hello inline world');
      send('a', '/upload', false, body);

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      expect(answerOf('a')).toEqual({ size: body.length, sha256: sha256(body) });
    });

    it('keeps every byte', async () => {
      const body = Buffer.from(Array.from({ length: 256 }, (_, value) => value));
      send('a', '/upload', false, body);

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      expect(answerOf('a')).toEqual({ size: 256, sha256: sha256(body) });
    });

    it('is empty when it has no bytes', async () => {
      send('a', '/upload', false, Buffer.alloc(0));

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      expect(answerOf('a').size).toBe(0);
    });

    it('is read whole when it is a couple of hundred kilobytes', async () => {
      const body = crypto.randomBytes(200 * 1024);
      send('a', '/upload', false, body);

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      expect(answerOf('a')).toEqual({ size: body.length, sha256: sha256(body) });
    });

    it('is not acknowledged, as there are no parts, and parts that arrive for the request anyway are left alone', async () => {
      const body = Buffer.from('inline');
      send('a', '/upload-late', false, body);
      sendPart('a', Buffer.alloc(100));
      sendPart('a');

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      expect(answerOf('a').size).toBe(body.length);
      expect(of('a', WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE)).toHaveLength(0);
    });

    it('keeps the bodies of requests that run at the same time apart', async () => {
      const bodies = ['one', 'two two', 'three three three'].map((text) => Buffer.from(text));
      bodies.forEach((body, index) => send(`r${index}`, '/upload', false, body));

      await until(() => bodies.every((_, index) => of(`r${index}`, WORKER_EVENT.RESPONSE).length === 1));

      bodies.forEach((body, index) => expect(answerOf(`r${index}`)).toEqual({ size: body.length, sha256: sha256(body) }));
    });
  });

  describe('metrics', () => {
    const createMetrics = (uptimeSeconds: number): ServerMetrics => ({
      uptimeSeconds,
      memory: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 },
      eventLoopDelayMs: { mean: 0, p99: 0, max: 0 },
      requests: { total: 0, active: 0, status: { '1xx': 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 } },
      sources: {},
    });

    /** plays the server: answers every question of a worker for metrics with the next of the given uptimes */
    const serveMetrics = (...uptimes: number[]) => {
      let answered = 0;
      const timer = setInterval(() => {
        const asked = received.filter(({ type }) => type === WORKER_EVENT.METRICS_REQUEST);
        asked.slice(answered).forEach(({ requestId }) => {
          channel.send({ type: WORKER_EVENT.METRICS, requestId, event: createMetrics(uptimes[answered]) });
          answered += 1;
        });
      }, 5);

      return () => clearInterval(timer);
    };

    it('gives the worker the metrics of the server on request', async () => {
      const stop = serveMetrics(42);
      send('a', '/metrics');

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      expect(JSON.parse(of('a', WORKER_EVENT.RESPONSE)[0].event.body.toString())).toMatchObject({ uptimeSeconds: 42 });
      expect(of('a', WORKER_EVENT.METRICS_REQUEST)).toHaveLength(1);
      stop();
    });

    it('answers the questions of one request in the order they were asked', async () => {
      const stop = serveMetrics(1, 2);
      send('a', '/metrics-twice');

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);

      expect(JSON.parse(of('a', WORKER_EVENT.RESPONSE)[0].event.body.toString())).toEqual([1, 2]);
      stop();
    });

    it('does not ask for metrics unless the worker does', async () => {
      send('a', '/plain');

      await until(() => of('a', WORKER_EVENT.RESPONSE).length === 1);
      await settle();

      expect(received.filter(({ type }) => type === WORKER_EVENT.METRICS_REQUEST)).toHaveLength(0);
    });
  });
});
