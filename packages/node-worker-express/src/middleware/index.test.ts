import express from 'express';
import fs from 'fs/promises';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { RequestBodyWindow, WebSocketWindow, WORKER_EVENT } from '../constants';
import { getServerMetrics } from '../utils/metrics';
import WorkerAbandonedError from '../utils/workerAbandonedError';
import WorkerBusyError from '../utils/workerBusyError';
import WorkerUnavailableError from '../utils/workerUnavailableError';
import { clientFrame } from '../utils/ws-client-frame.test-helper';
import workerMiddleware from './index';

type Handlers = { onMessage: (message: unknown) => void; onExit: (code: number | null) => void };

jest.mock('../utils/workerPool', () => {
  class FakePool {
    static last: FakePool;
    acquire = jest.fn();
    warm = jest.fn();
    getStats = () => ({ workers: 2, active: 1, waiting: 0, paths: {} });

    constructor(readonly params: { onStdout?: () => void; onStderr?: () => void; maxQueue?: number; acquireTimeout?: number }) {
      FakePool.last = this;
    }
  }

  return { __esModule: true, default: FakePool };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const FakePool = require('../utils/workerPool').default;

describe('workerMiddleware', () => {
  let root: string;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'middleware-'));
    await fs.writeFile(path.join(root, 'exampleWorker.js'), '');
    await fs.mkdir(path.join(root, 'plain'));
  });

  afterAll(() => fs.rm(root, { recursive: true, force: true }));

  afterEach(() => new Promise((resolve) => server.close(resolve)));

  const until = async (condition: () => boolean) => {
    for (let waited = 0; !condition() && waited < 3000; waited += 5) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(condition()).toBe(true);
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

  const start = async (options = {}) => {
    const app = express();
    app.use(workerMiddleware({ root, index: ['exampleWorker.js'], limitResponseTimeout: 200, ...options }));
    app.use((error, request, response, next) => response.status(500).send(`${error.message}`));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${(server.address() as { port: number }).port}`;
  };

  /** a lease whose worker reacts to the request through `react` */
  const createLease = (react: (handlers: Handlers, requestId: string) => void) => {
    let handlers: Handlers;
    const stream = { on: jest.fn(), off: jest.fn() };
    const lease = {
      worker: { instance: { stdout: stream, stderr: stream } },
      send: jest.fn(
        (message: { type: string; requestId: string; event?: { headers: Record<string, string> } }) =>
          message.type === WORKER_EVENT.REQUEST && setImmediate(() => react(handlers, message.requestId))
      ),
      subscribe: jest.fn((requestId: string, onMessage: Handlers['onMessage'], onExit: Handlers['onExit']) => {
        handlers = { onMessage, onExit };
      }),
      release: jest.fn(),
    };

    return lease;
  };

  /** every request gets this lease */
  const mockLease = (react: (handlers: Handlers, requestId: string) => void) => {
    const lease = createLease(react);
    FakePool.last.acquire.mockResolvedValue(lease);

    return lease;
  };

  /** every request gets a lease of its own, as requests that run at the same time do, the leases are listed as they are handed out */
  const mockLeases = (react: (handlers: Handlers, requestId: string) => void) => {
    const leases: Array<ReturnType<typeof createLease>> = [];
    FakePool.last.acquire.mockImplementation(async () => {
      const lease = createLease(react);
      leases.push(lease);

      return lease;
    });

    return leases;
  };

  it('answers with what the worker responds with and frees the worker', async () => {
    await start();
    const lease = mockLease((handlers, requestId) =>
      handlers.onMessage({
        type: WORKER_EVENT.RESPONSE,
        requestId,
        event: { statusCode: 201, headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('hello') },
      })
    );

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(201);
    expect(await response.text()).toBe('hello');
    await new Promise((resolve) => setImmediate(resolve));
    expect(lease.release).toHaveBeenCalled();
  });

  it('answers 502 and frees the worker when the worker exits during the request', async () => {
    await start();
    const lease = mockLease((handlers) => handlers.onExit(1));

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(502);
    expect(lease.release).toHaveBeenCalled();
  });

  it('answers 504 and frees the worker when the worker stays silent', async () => {
    await start({ limitResponseTimeout: 50 });
    const lease = mockLease(() => {});

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(504);
    expect(lease.release).toHaveBeenCalled();
  });

  it('does not time out when the timeout is disabled', async () => {
    await start({ limitResponseTimeout: 0 });
    mockLease((handlers, requestId) =>
      setTimeout(() => handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('late') } }), 150)
    );

    expect(await (await fetch(`${baseUrl}/`)).text()).toBe('late');
  });

  it('fails the request when no worker can be provided', async () => {
    await start();
    FakePool.last.acquire.mockRejectedValue(new Error('No worker became available'));

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(500);
    expect(await response.text()).toContain('No worker became available');
  });

  it('passes the limit per path on when acquiring a worker', async () => {
    await start({ limitPerPath: (workerPath: string) => (workerPath.endsWith('exampleWorker.js') ? 7 : 1) });
    mockLease((handlers, requestId) =>
      handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('') } })
    );

    await fetch(`${baseUrl}/`);

    expect(FakePool.last.acquire).toHaveBeenCalledWith(path.join(root, 'exampleWorker.js'), expect.anything(), 7, expect.any(AbortSignal));
  });

  describe('messages to the worker', () => {
    it('sends the request and nothing else for a plain response, which the worker does not wait for', async () => {
      await start();
      const lease = mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('hello') } })
      );

      await (await fetch(`${baseUrl}/`)).text();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(lease.send.mock.calls.map(([message]) => message.type)).toEqual([WORKER_EVENT.REQUEST]);
    });
  });

  describe('response bodies', () => {
    const respondWith = (body?: Buffer) =>
      mockLease((handlers, requestId) => handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body } }));

    it('writes the bytes of a response as they are', async () => {
      await start();
      const bytes = Buffer.from(Array.from({ length: 256 }, (_, value) => value));
      respondWith(bytes);

      const response = await fetch(`${baseUrl}/`);

      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
      expect(response.headers.get('content-length')).toBe('256');
    });

    it('answers with an empty body when the worker sent none', async () => {
      await start();
      respondWith(undefined);

      const response = await fetch(`${baseUrl}/`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
    });
  });

  describe('response headers', () => {
    const respondWith = (headers: Record<string, string | number>) =>
      mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers, body: Buffer.from('hello') } })
      );

    it('adds the size of the body when the worker does not say it', async () => {
      await start();
      respondWith({ 'Content-Type': 'text/plain' });

      const response = await fetch(`${baseUrl}/`);

      expect(response.headers.get('content-length')).toBe('5');
      expect(response.headers.get('transfer-encoding')).toBeNull();
    });

    it.each(['Content-Length', 'content-length'])('keeps a %s of the worker', async (name) => {
      await start();
      respondWith({ [name]: 5 });

      expect((await fetch(`${baseUrl}/`)).headers.get('content-length')).toBe('5');
    });

    it('leaves a chunked answer of the worker alone', async () => {
      await start();
      respondWith({ 'Transfer-Encoding': 'chunked' });

      const response = await fetch(`${baseUrl}/`);

      expect(response.headers.get('content-length')).toBeNull();
      expect(await response.text()).toBe('hello');
    });
  });

  describe('spawn options of the workers', () => {
    it('are made by a function, as copying the environment for every request is costly', async () => {
      await start({ env: { FROM_CONFIG: 'yes' }, cwd: '/somewhere' });
      mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('') } })
      );

      await fetch(`${baseUrl}/`);

      const options = FakePool.last.acquire.mock.calls[0][1];
      expect(typeof options).toBe('function');
      expect(options()).toMatchObject({
        cwd: '/somewhere',
        env: expect.objectContaining({ FROM_CONFIG: 'yes', PATH: process.env.PATH }),
      });
    });
  });

  describe('warming the static worker', () => {
    it('starts a static worker together with the middleware', async () => {
      await start({ staticWorker: '/static-worker.js' });

      expect(FakePool.last.warm).toHaveBeenCalledTimes(1);
      expect(FakePool.last.warm).toHaveBeenCalledWith('/static-worker.js', expect.objectContaining({ cwd: process.cwd() }));
    });

    it('can be switched off', async () => {
      await start({ warmStaticWorker: false });

      expect(FakePool.last.warm).not.toHaveBeenCalled();
    });

    it('asks for the static worker with the same options when a file is requested, so the started one is used', async () => {
      await start({ staticWorker: '/static-worker.js' });
      mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('') } })
      );

      await fetch(`${baseUrl}/plain/file.txt`);

      expect(FakePool.last.acquire.mock.calls[0][1]).toBe(FakePool.last.warm.mock.calls[0][1]);
    });
  });

  describe('streamed responses', () => {
    /** every byte value, as text decoding would damage the ones above 127 */
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, value) => value));
    const part = (requestId: string, body: Buffer | null) => ({
      type: WORKER_EVENT.RESPONSE_EMIT,
      requestId,
      event: {
        statusCode: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
        emit: true,
        body,
      },
    });

    it('writes the bytes of every part to the client and acknowledges them once they are written', async () => {
      await start();
      const lease = mockLease((handlers, requestId) => {
        handlers.onMessage(part(requestId, bytes));
        handlers.onMessage(part(requestId, bytes));
        handlers.onMessage(part(requestId, null));
      });

      const response = await fetch(`${baseUrl}/`);

      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.concat([bytes, bytes]));
      const acknowledgements = lease.send.mock.calls.filter(([message]) => message.type === WORKER_EVENT.RESPONSE_ACKNOWLEDGE);
      expect(acknowledgements).toHaveLength(3);
    });

    it('tells the worker to stop when the client goes away during the response', async () => {
      await start();
      const lease = mockLease((handlers, requestId) => handlers.onMessage(part(requestId, bytes)));

      await new Promise<void>((resolve, reject) => {
        const clientRequest = http.get(`${baseUrl}/`, (response) =>
          response.once('data', () => {
            response.destroy();
            resolve();
          })
        );
        clientRequest.on('error', reject);
      });
      // the server notices that the client left a moment later
      for (let waited = 0; !lease.send.mock.calls.some(([message]) => message.type === WORKER_EVENT.REQUEST_ABORT) && waited < 3000; waited += 5) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      expect(lease.send).toHaveBeenCalledWith(expect.objectContaining({ type: WORKER_EVENT.REQUEST_ABORT }));
      expect(lease.release).toHaveBeenCalled();
    });

    it('does not tell the worker to stop after a complete response', async () => {
      await start();
      const lease = mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('done') } })
      );

      await (await fetch(`${baseUrl}/`)).text();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(lease.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: WORKER_EVENT.REQUEST_ABORT }));
    });

    it('ends a response early when the worker stops sending parts', async () => {
      await start({ limitResponseTimeout: 50 });
      const lease = mockLease((handlers, requestId) => handlers.onMessage(part(requestId, bytes)));

      const response = await fetch(`${baseUrl}/`);

      await expect(response.arrayBuffer()).rejects.toThrow();
      expect(lease.release).toHaveBeenCalled();
    });

    it('keeps a response going while parts keep coming, even if it takes longer than the timeout', async () => {
      // the parts come in a fifth of the timeout, which a slow machine can be late for, and all of them together take longer than it
      await start({ limitResponseTimeout: 150 });
      mockLease((handlers, requestId) => {
        const send = (index: number) => {
          handlers.onMessage(part(requestId, index < 8 ? bytes : null));
          if (index < 8) setTimeout(() => send(index + 1), 30);
        };
        send(0);
      });

      const response = await fetch(`${baseUrl}/`);

      expect((await response.arrayBuffer()).byteLength).toBe(bytes.length * 8);
    });
  });

  describe('streamed request bodies', () => {
    type Message = { type: string; requestId: string; event?: { body?: Buffer | null; hasBody?: boolean } };

    /** a lease whose worker is told every message that was sent to it, `answer` decides how it reacts */
    const mockUploadLease = (answer: (message: Message, handlers: Handlers) => void) => {
      let handlers: Handlers;
      const stream = { on: jest.fn(), off: jest.fn() };
      const lease = {
        worker: { instance: { stdout: stream, stderr: stream } },
        send: jest.fn((message: Message) => setImmediate(() => answer(message, handlers))),
        subscribe: jest.fn((requestId: string, onMessage: Handlers['onMessage'], onExit: Handlers['onExit']) => {
          handlers = { onMessage, onExit };
        }),
        release: jest.fn(),
      };
      FakePool.last.acquire.mockResolvedValue(lease);

      return lease;
    };

    const messagesOf = (lease: ReturnType<typeof mockUploadLease>, type: string) =>
      lease.send.mock.calls.map(([message]) => message).filter((message) => message.type === type);
    const bytesOf = (lease: ReturnType<typeof mockUploadLease>) =>
      Buffer.concat(
        messagesOf(lease, WORKER_EVENT.REQUEST_BODY)
          .filter(({ event }) => event.body !== null)
          .map(({ event }) => event.body)
      );
    const acknowledge = (handlers: Handlers, requestId: string) => handlers.onMessage({ type: WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE, requestId });
    const respond = (handlers: Handlers, requestId: string, statusCode = 200, body = 'done') =>
      handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode, headers: {}, body: Buffer.from(body) } });

    /** acknowledges every part of the body and answers when it ended */
    const answerWhenEnded = (message: Message, handlers: Handlers) => {
      if (message.type !== WORKER_EVENT.REQUEST_BODY) return;
      if (message.event.body === null) respond(handlers, message.requestId);
      else acknowledge(handlers, message.requestId);
    };

    const send = (chunks: Buffer[], { method = 'POST', requestPath = '/' } = {}) =>
      new Promise<{ status: number; text: string }>((resolve, reject) => {
        const request = http.request(`${baseUrl}${requestPath}`, { method }, (response) => {
          const parts: Buffer[] = [];
          response.on('data', (part) => parts.push(part));
          response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(parts).toString() }));
        });
        request.on('error', reject);
        chunks.forEach((chunk) => request.write(chunk));
        request.end();
      });

    it('hands the body to the worker in parts that make up the body, and ends them', async () => {
      await start();
      const lease = mockUploadLease(answerWhenEnded);
      const body = crypto.randomBytes(300000);

      const response = await send([body]);

      expect(response).toEqual({ status: 200, text: 'done' });
      const parts = messagesOf(lease, WORKER_EVENT.REQUEST_BODY);
      expect(parts.length).toBeGreaterThan(2);
      expect(parts[parts.length - 1].event.body).toBeNull();
      expect(bytesOf(lease).equals(body)).toBe(true);
    });

    it('sends the request without its body and says that the body follows', async () => {
      // streamed, as even a small body that arrived with the request would go along with it otherwise
      await start({ inlineRequestBody: 0 });
      const lease = mockUploadLease(answerWhenEnded);

      await send([Buffer.from('hello')]);

      const [request] = messagesOf(lease, WORKER_EVENT.REQUEST);
      expect(request.event).toMatchObject({ hasBody: true });
      expect(request.event).not.toHaveProperty('body');
    });

    it('calls the worker before the body has arrived, and passes on what comes later', async () => {
      await start();
      const lease = mockUploadLease(answerWhenEnded);
      const request = http.request(`${baseUrl}/`, { method: 'POST' });
      request.on('error', () => {});
      const answered = new Promise((resolve) => request.on('response', resolve));

      request.write('first ');
      await until(() => bytesOf(lease).toString() === 'first ');
      expect(messagesOf(lease, WORKER_EVENT.REQUEST)).toHaveLength(1);
      expect(messagesOf(lease, WORKER_EVENT.REQUEST_BODY).every(({ event }) => event.body !== null)).toBe(true);

      request.end('second');
      await answered;
      expect(bytesOf(lease).toString()).toBe('first second');
    });

    it('holds the body back while the worker has not taken the parts it was sent', async () => {
      await start();
      const lease = mockUploadLease(() => {});
      const request = http.request(`${baseUrl}/`, { method: 'POST' });
      request.on('error', () => {});

      // many times the window
      Array.from({ length: 40 }).forEach(() => request.write(Buffer.alloc(65536)));
      // the window is sent, and then it is held back: give what is not allowed to follow the time to arrive
      await until(() => messagesOf(lease, WORKER_EVENT.REQUEST_BODY).length >= RequestBodyWindow);
      await settle();
      const sentWithoutAcknowledgement = messagesOf(lease, WORKER_EVENT.REQUEST_BODY).length;
      expect(sentWithoutAcknowledgement).toBe(RequestBodyWindow);

      const [requestId, onMessage] = lease.subscribe.mock.calls[0];
      onMessage({ type: WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE, requestId });
      await until(() => messagesOf(lease, WORKER_EVENT.REQUEST_BODY).length === sentWithoutAcknowledgement + 1);
      await settle();
      expect(messagesOf(lease, WORKER_EVENT.REQUEST_BODY)).toHaveLength(sentWithoutAcknowledgement + 1);
      request.destroy();
    });

    it('does not stream requests that have no body', async () => {
      await start();
      const lease = mockUploadLease((message, handlers) => message.type === WORKER_EVENT.REQUEST && respond(handlers, message.requestId));

      await send([], { method: 'GET' });

      expect(messagesOf(lease, WORKER_EVENT.REQUEST)[0].event).not.toHaveProperty('hasBody');
    });

    it('does not take the worker away when the body has been read, while it works on the answer', async () => {
      await start({ limitResponseTimeout: 2000, inlineRequestBody: 0 });
      const lease = mockUploadLease((message, handlers) => {
        if (message.type !== WORKER_EVENT.REQUEST_BODY) return;
        if (message.event.body === null) setTimeout(() => respond(handlers, message.requestId, 200, 'late answer'), 200);
        else acknowledge(handlers, message.requestId);
      });

      const response = await send([Buffer.from('hello')]);

      expect(response).toEqual({ status: 200, text: 'late answer' });
      expect(messagesOf(lease, WORKER_EVENT.REQUEST_ABORT)).toHaveLength(0);
    });

    it('tells the worker when the client goes away during the upload', async () => {
      await start();
      const lease = mockUploadLease(answerWhenEnded);
      const request = http.request(`${baseUrl}/`, { method: 'POST' });
      request.on('error', () => {});

      request.write('part of it');
      await until(() => bytesOf(lease).length > 0);
      request.destroy();

      await until(() => messagesOf(lease, WORKER_EVENT.REQUEST_ABORT).length > 0);
      expect(lease.release).toHaveBeenCalled();
    });

    it('answers 413 and tells the worker when the body exceeds the limit for the body', async () => {
      await start({ limitRequestBody: 100000 });
      const lease = mockUploadLease(answerWhenEnded);

      const response = await send([Buffer.alloc(500000)]).catch(() => ({ status: 413, text: '' }));

      expect(response.status).toBe(413);
      await until(() => messagesOf(lease, WORKER_EVENT.REQUEST_ABORT).length > 0);
    });

    it('lets a body that is within the limit for the body through', async () => {
      await start({ limitRequestBody: 100000 });
      mockUploadLease(answerWhenEnded);

      expect((await send([Buffer.alloc(99999)])).status).toBe(200);
    });

    it('reads and drops the rest of a body that the worker did not wait for', async () => {
      await start();
      // answers while the upload is held back, as the worker has not taken the parts it was sent
      let parts = 0;
      mockUploadLease((message, handlers) => {
        if (message.type === WORKER_EVENT.REQUEST_BODY && (parts += 1) === RequestBodyWindow) respond(handlers, message.requestId, 413, 'too large');
      });

      const connections: net.Socket[] = [];
      server.on('connection', (socket) => connections.push(socket));

      const response = await send([Buffer.alloc(20 * 1024 * 1024)]);

      expect(response).toEqual({ status: 413, text: 'too large' });
      // the whole upload is taken from the connection, which otherwise could not be used for the next request
      await until(() => connections[0].bytesRead >= 20 * 1024 * 1024);
      await settle();
    });

    it('does not stream the body of a request that the static worker answers', async () => {
      await start();
      const lease = mockUploadLease((message, handlers) => message.type === WORKER_EVENT.REQUEST && respond(handlers, message.requestId));

      await send([Buffer.from('hello')], { requestPath: '/plain/missing' });

      expect(FakePool.last.acquire).toHaveBeenCalledWith(
        expect.stringMatching(/staticWorker\.js$/),
        expect.anything(),
        expect.anything(),
        expect.any(AbortSignal)
      );
      expect(messagesOf(lease, WORKER_EVENT.REQUEST)[0].event).not.toHaveProperty('hasBody');
    });
  });

  describe('request ids', () => {
    it('gives every request an id of its own, also for requests that run at the same time', async () => {
      await start();
      const leases = mockLeases((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('ok') } })
      );

      await Promise.all(Array.from({ length: 20 }, () => fetch(`${baseUrl}/`)));

      const ids = leases.flatMap(({ send }) => send.mock.calls.map(([message]) => message.requestId));
      expect(ids).toHaveLength(20);
      expect(new Set(ids).size).toBe(20);
    });
  });

  describe('finding the way to a worker', () => {
    const answer = () => mockLease((handlers, requestId) => respond(handlers, requestId));
    const answerAll = () => mockLeases((handlers, requestId) => respond(handlers, requestId));
    const respond = (handlers: Handlers, requestId: string) =>
      handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('ok') } });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('does not ask the file system again for a path that was resolved lately, until the entry expires', async () => {
      await start();
      answer();
      const access = jest.spyOn(fs, 'access');
      const stat = jest.spyOn(fs, 'stat');
      const now = Date.now();

      await fetch(`${baseUrl}/some/page`);
      const asked = access.mock.calls.length + stat.mock.calls.length;
      expect(asked).toBeGreaterThan(0);

      // the file system answers of the resolving itself are remembered for a second, the way to the path for five
      jest.spyOn(Date, 'now').mockReturnValue(now + 2000);
      await fetch(`${baseUrl}/some/page`);
      expect(access.mock.calls.length + stat.mock.calls.length).toBe(asked);

      jest.spyOn(Date, 'now').mockReturnValue(now + 6000);
      await fetch(`${baseUrl}/some/page`);
      expect(access.mock.calls.length + stat.mock.calls.length).toBeGreaterThan(asked);
    });

    it('asks only about the new part of a path for requests to many different paths below the same directory', async () => {
      await start();
      answerAll();
      const access = jest.spyOn(fs, 'access');
      await fetch(`${baseUrl}/scan/0`);
      const afterFirst = access.mock.calls.length;

      await Promise.all(Array.from({ length: 30 }, (_, index) => fetch(`${baseUrl}/scan/${index + 1}`)));

      // the question about the new path, for each of them
      expect(access.mock.calls.length - afterFirst).toBe(30);
    });

    it('sends the paths that are not a worker to the static worker', async () => {
      await start();
      answer();

      await fetch(`${baseUrl}/plain/missing`);

      expect(FakePool.last.acquire).toHaveBeenCalledWith(
        expect.stringMatching(/staticWorker\.js$/),
        expect.anything(),
        expect.anything(),
        expect.any(AbortSignal)
      );
    });
  });

  describe('bodies for the static worker', () => {
    it('reads and drops them', async () => {
      await start();
      mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 404, headers: {}, body: Buffer.from('missing') } })
      );
      const connections: net.Socket[] = [];
      server.on('connection', (socket) => connections.push(socket));

      // a client that sends all of it, as a browser does, where fetch gives up its upload when the answer arrives
      const status = await new Promise<number>((resolve, reject) => {
        const request = http.request(`${baseUrl}/plain/missing`, { method: 'POST' }, (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        });
        request.on('error', reject);
        request.end(Buffer.alloc(20 * 1024 * 1024));
      });

      expect(status).toBe(404);
      // the whole upload is taken from the connection, which otherwise could not be used for the next request
      for (let waited = 0; connections[0].bytesRead < 20 * 1024 * 1024 && waited < 3000; waited += 10) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(connections[0].bytesRead).toBeGreaterThanOrEqual(20 * 1024 * 1024);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });

  describe('metrics', () => {
    it('answers the question of a worker for the metrics of the server', async () => {
      await start();
      const lease = mockLease((handlers, requestId) => {
        handlers.onMessage({ type: WORKER_EVENT.METRICS_REQUEST, requestId });
        setTimeout(() => handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('ok') } }), 20);
      });

      await fetch(`${baseUrl}/`);

      const answers = lease.send.mock.calls.map(([message]) => message).filter((message) => message.type === WORKER_EVENT.METRICS);
      expect(answers).toHaveLength(1);
      expect(answers[0].event).toMatchObject({
        uptimeSeconds: expect.any(Number),
        memory: { rss: expect.any(Number) },
        requests: { total: expect.any(Number) },
      });
    });

    it('lists the worker pool of the middleware among the sources, and counts the requests', async () => {
      await start();
      mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 404, headers: {}, body: Buffer.from('') } })
      );
      const before = getServerMetrics().requests;

      await fetch(`${baseUrl}/`);
      await new Promise((resolve) => setImmediate(resolve));

      const { sources, requests } = getServerMetrics();
      expect(sources[`workers:${root}`]).toEqual({ workers: 2, active: 1, waiting: 0, paths: {} });
      expect(requests.total - before.total).toBe(1);
      expect(requests.status['4xx'] - before.status['4xx']).toBe(1);
    });
  });

  describe('output of the workers', () => {
    it('leaves handing the output of the workers to the pool, once for each worker, not for every request', async () => {
      const onStdout = jest.fn();
      const onStderr = jest.fn();
      await start({ onStdout, onStderr });
      const lease = mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('ok') } })
      );

      await fetch(`${baseUrl}/`);
      await fetch(`${baseUrl}/`);

      expect(FakePool.last.params).toMatchObject({ onStdout, onStderr });
      expect(lease.worker.instance.stdout.on).not.toHaveBeenCalled();
      expect(lease.worker.instance.stderr.on).not.toHaveBeenCalled();
    });
  });

  describe('workers that keep failing', () => {
    it('answers 503 with the time to wait, without telling where the worker is', async () => {
      await start();
      FakePool.last.acquire.mockRejectedValue(new WorkerUnavailableError('/srv/secret/worker.js', 2500));

      const response = await fetch(`${baseUrl}/`);

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('3');
      expect(await response.text()).toBe('Service unavailable.');
    });

    it('answers 503 as well when the request waited for a worker for too long, or too many wait already', async () => {
      await start();
      FakePool.last.acquire.mockRejectedValue(
        new WorkerBusyError('/srv/secret/worker.js', 'No worker became available for /srv/secret/worker.js within 5000ms.')
      );

      const response = await fetch(`${baseUrl}/`);

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('1');
      expect(await response.text()).toBe('Service unavailable.');
    });

    it('asks to wait at least a second', async () => {
      await start();
      FakePool.last.acquire.mockRejectedValue(new WorkerUnavailableError('/srv/worker.js', 100));

      expect((await fetch(`${baseUrl}/`)).headers.get('retry-after')).toBe('1');
    });
  });

  describe('the line for a worker', () => {
    it('is 1000 requests long by default', async () => {
      await start();

      expect(FakePool.last.params.maxQueue).toBe(1000);
    });

    it('is as long as the limit for the queue says', async () => {
      await start({ limitQueue: 5 });

      expect(FakePool.last.params.maxQueue).toBe(5);
    });

    it('is as long as it is, with a limit of 0', async () => {
      await start({ limitQueue: 0 });

      expect(FakePool.last.params.maxQueue).toBe(0);
    });

    it('aborts the wait when the client goes away, and answers nothing', async () => {
      await start();
      let signal: AbortSignal | undefined;
      FakePool.last.acquire.mockImplementation(
        (_path: string, _options: object, _limit: number, abortSignal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal = abortSignal;
            abortSignal.addEventListener('abort', () => reject(new WorkerAbandonedError('/srv/worker.js')));
          })
      );
      const writeHead = jest.spyOn(http.ServerResponse.prototype, 'writeHead');
      const request = http.get(`${baseUrl}/`);
      request.on('error', () => undefined);
      await until(() => signal !== undefined);

      expect(signal.aborted).toBe(false);
      request.destroy();
      await until(() => signal.aborted);
      await settle();

      expect(writeHead).not.toHaveBeenCalled();
      writeHead.mockRestore();
    });

    it('does not abort the wait of a request that got its worker', async () => {
      await start();
      let signal: AbortSignal | undefined;
      FakePool.last.acquire.mockImplementation(async (_path: string, _options: object, _limit: number, abortSignal: AbortSignal) => {
        signal = abortSignal;

        return createLease((handlers, requestId) =>
          handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('ok') } })
        );
      });

      await (await fetch(`${baseUrl}/`)).text();
      await settle();

      expect(signal.aborted).toBe(false);
    });

    it('lets a request wait for as long as the request timeout says', async () => {
      await start({ limitRequestTimeout: 1234 });

      expect(FakePool.last.params.acquireTimeout).toBe(1234);
    });
  });

  describe('the time a response may take', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    const part = (requestId: string, body: Buffer | null) => ({
      type: WORKER_EVENT.RESPONSE_EMIT,
      requestId,
      event: { statusCode: 200, headers: {}, emit: true, body },
    });

    it('is watched by one timer for the whole response, however many parts come in', async () => {
      await start({ limitResponseTimeout: 777 });
      mockLease((handlers, requestId) => {
        Array.from({ length: 50 }).forEach(() => handlers.onMessage(part(requestId, Buffer.from('part'))));
        handlers.onMessage(part(requestId, null));
      });
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      const response = await fetch(`${baseUrl}/`);
      await response.arrayBuffer();

      // one for the response, a second at most when it looked again
      expect(setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 777).length).toBeLessThanOrEqual(2);
    });

    it('runs out when nothing moves for as long as the limit, also after parts came in', async () => {
      await start({ limitResponseTimeout: 150 });
      mockLease((handlers, requestId) => handlers.onMessage(part(requestId, Buffer.from('first part'))));

      const response = await fetch(`${baseUrl}/`);

      // the headers are out, so the connection is cut instead of answered with 504
      await expect(response.arrayBuffer()).rejects.toThrow();
    });

    it('goes on while parts keep coming, for longer than the limit', async () => {
      // a part comes in a fifth of the limit, and all of them together take longer than it
      await start({ limitResponseTimeout: 150 });
      mockLease((handlers, requestId) => {
        const parts = [1, 2, 3, 4, 5, 6, 7, 8].map((number) => () => handlers.onMessage(part(requestId, Buffer.from(`part ${number} `))));
        parts.forEach((send, index) => setTimeout(send, index * 30));
        setTimeout(() => handlers.onMessage(part(requestId, null)), parts.length * 30);
      });

      const response = await fetch(`${baseUrl}/`);

      expect(await response.text()).toBe('part 1 part 2 part 3 part 4 part 5 part 6 part 7 part 8 ');
    });
  });

  describe('bodies that arrive with the request', () => {
    type Sent = { type: string; requestId: string; event?: { inlineBody?: string; hasBody?: boolean; body?: Buffer | null } };

    /** answers the request as soon as it is there, and the parts of a body as they come */
    const answerAtOnce = (message: Sent, handlers: Handlers) => {
      if (message.type === WORKER_EVENT.REQUEST) respond(handlers, message.requestId);
      if (message.type === WORKER_EVENT.REQUEST_BODY) acknowledge(handlers, message.requestId);
    };
    const respond = (handlers: Handlers, requestId: string) =>
      handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('ok') } });
    const acknowledge = (handlers: Handlers, requestId: string) => handlers.onMessage({ type: WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE, requestId });

    interface Lease {
      send: jest.Mock<unknown, [Sent]>;
      subscribe: jest.Mock;
      release: jest.Mock;
    }

    const mockLeaseAnswering = (answer: (message: Sent, handlers: Handlers) => void = answerAtOnce) => {
      const created: Lease[] = [];
      FakePool.last.acquire.mockImplementation(async () => {
        let handlers: Handlers;
        const stream = { on: jest.fn(), off: jest.fn() };
        const lease = {
          worker: { instance: { stdout: stream, stderr: stream } },
          send: jest.fn((message: Sent) => setImmediate(() => answer(message, handlers))),
          subscribe: jest.fn((requestId: string, onMessage: Handlers['onMessage'], onExit: Handlers['onExit']) => {
            handlers = { onMessage, onExit };
          }),
          release: jest.fn(),
        };
        created.push(lease);

        return lease;
      });

      return created;
    };

    const messagesOf = (leases: Lease[], type: string): Sent[] =>
      leases.flatMap(({ send }) => send.mock.calls.map(([message]) => message)).filter((message) => message.type === type);

    /** sends a request over a socket of its own, in the writes that are given: whatever is in one write arrives together, which fetch does not let one decide */
    const rawRequest = (head: string, writes: Array<Buffer | string>, beforeNextWrite?: () => Promise<unknown>) =>
      new Promise<string>((resolve, reject) => {
        const socket = net.connect(Number(new URL(baseUrl).port), '127.0.0.1');
        const received: Buffer[] = [];
        socket.on('data', (chunk) => received.push(chunk));
        socket.on('end', () => resolve(Buffer.concat(received).toString()));
        socket.on('error', reject);
        socket.on('connect', async () => {
          const requestHead = `${head}\r\nHost: web.localhost\r\nConnection: close\r\n\r\n`;
          // without a pause the head and the first part of the body are a single write, two writes in a row can arrive apart
          const [first, ...rest] = writes;
          const parts =
            beforeNextWrite || first === undefined ? [requestHead, ...writes] : [Buffer.concat([Buffer.from(requestHead), Buffer.from(first)]), ...rest];
          for (const part of parts) {
            socket.write(part);
            await beforeNextWrite?.();
          }
        });
      });

    /** the head and the body in a single write, so they arrive together */
    const postTogether = (body: Buffer | string, path = '/') => {
      const bytes = Buffer.from(body);

      return rawRequest(`POST ${path} HTTP/1.1\r\nContent-Length: ${bytes.length}`, [bytes]);
    };

    /** the head in a write of its own, the body in the next one, which is only written once the request has been handed on to a worker: no pause can guarantee that */
    const postApart = (body: string, leases: Lease[]) =>
      rawRequest(`POST / HTTP/1.1\r\nContent-Length: ${Buffer.byteLength(body)}`, [body], async () => {
        while (messagesOf(leases, WORKER_EVENT.REQUEST).length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
      });

    it('goes along with the request when it is small, with no parts after it', async () => {
      await start();
      const leases = mockLeaseAnswering();

      const response = await postTogether('hello world');

      expect(response).toContain('200 OK');
      const [request] = messagesOf(leases, WORKER_EVENT.REQUEST);
      expect(Buffer.from(request.event.inlineBody, 'base64').toString()).toBe('hello world');
      expect(request.event).not.toHaveProperty('hasBody');
      expect(messagesOf(leases, WORKER_EVENT.REQUEST_BODY)).toHaveLength(0);
    });

    it('keeps every byte', async () => {
      await start();
      const leases = mockLeaseAnswering();
      const bytes = Buffer.from(Array.from({ length: 256 }, (_, value) => value));

      await postTogether(bytes);

      expect(Buffer.from(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event.inlineBody, 'base64')).toEqual(bytes);
    });

    it('is empty for a request of no bytes, which needs no parts either', async () => {
      await start();
      const leases = mockLeaseAnswering();

      await postTogether('');

      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event.inlineBody).toBe('');
      expect(messagesOf(leases, WORKER_EVENT.REQUEST_BODY)).toHaveLength(0);
    });

    it('also holds for the requests after the first one, which find their way in the cache', async () => {
      await start();
      const leases = mockLeaseAnswering();

      await postTogether('first');
      await postTogether('second');
      await postTogether('third');

      expect(messagesOf(leases, WORKER_EVENT.REQUEST).map(({ event }) => Buffer.from(event.inlineBody, 'base64').toString())).toEqual([
        'first',
        'second',
        'third',
      ]);
    });

    it('is also how a small body with chunks of its own, sent in one write, arrives', async () => {
      await start();
      const leases = mockLeaseAnswering();

      await rawRequest('POST / HTTP/1.1\r\nTransfer-Encoding: chunked', ['5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n']);

      expect(Buffer.from(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event.inlineBody, 'base64').toString()).toBe('hello world');
    });

    it('is streamed instead when the body comes after the request', async () => {
      await start();
      // the worker answers once it has the whole body, as the rest of a body is dropped when the response is done
      const leases = mockLeaseAnswering((message, handlers) => {
        if (message.type === WORKER_EVENT.REQUEST_BODY && message.event.body === null) respond(handlers, message.requestId);
        if (message.type === WORKER_EVENT.REQUEST_BODY && message.event.body !== null) acknowledge(handlers, message.requestId);
      });

      await postApart('a body that was sent later', leases);

      const [request] = messagesOf(leases, WORKER_EVENT.REQUEST);
      expect(request.event).toMatchObject({ hasBody: true });
      expect(request.event).not.toHaveProperty('inlineBody');
      expect(messagesOf(leases, WORKER_EVENT.REQUEST_BODY).length).toBeGreaterThan(0);
    });

    it('is streamed whole, never in two ways, when it is bigger than the limit for inline bodies', async () => {
      await start({ inlineRequestBody: 100 });
      const leases = mockLeaseAnswering();

      await postTogether(Buffer.alloc(101, 1));

      const [request] = messagesOf(leases, WORKER_EVENT.REQUEST);
      expect(request.event).toMatchObject({ hasBody: true });
      expect(request.event).not.toHaveProperty('inlineBody');
      const sent = Buffer.concat(
        messagesOf(leases, WORKER_EVENT.REQUEST_BODY)
          .filter(({ event }) => event.body !== null)
          .map(({ event }) => event.body)
      );
      expect(sent).toEqual(Buffer.alloc(101, 1));
    });

    it('goes along with the request when it is exactly as big as the limit', async () => {
      await start({ inlineRequestBody: 100 });
      const leases = mockLeaseAnswering();

      await postTogether(Buffer.alloc(100, 1));

      expect(Buffer.from(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event.inlineBody, 'base64')).toHaveLength(100);
      expect(messagesOf(leases, WORKER_EVENT.REQUEST_BODY)).toHaveLength(0);
    });

    it('is always streamed with a limit of 0', async () => {
      await start({ inlineRequestBody: 0 });
      const leases = mockLeaseAnswering();

      await postTogether('small');

      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event).toMatchObject({ hasBody: true });
      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event).not.toHaveProperty('inlineBody');
    });

    it('is refused with 413 before a worker is asked for when it is bigger than the limit for bodies', async () => {
      await start({ limitRequestBody: 50 });
      mockLeaseAnswering();

      const response = await postTogether(Buffer.alloc(60, 1));

      expect(response).toContain('413');
      expect(FakePool.last.acquire).not.toHaveBeenCalled();
    });

    it('is let through when it is exactly as big as the limit for bodies', async () => {
      await start({ limitRequestBody: 50 });
      mockLeaseAnswering();

      expect(await postTogether(Buffer.alloc(50, 1))).toContain('200 OK');
    });

    it('is not there for requests without a body', async () => {
      await start();
      const leases = mockLeaseAnswering();

      await rawRequest('GET / HTTP/1.1', []);

      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event).not.toHaveProperty('inlineBody');
      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event).not.toHaveProperty('hasBody');
    });

    it('is not there for what the static worker answers', async () => {
      await start();
      const leases = mockLeaseAnswering();

      await postTogether('ignored', '/plain/missing');

      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event).not.toHaveProperty('inlineBody');
    });

    it('lets the worker take its time to answer, without telling it that the client left', async () => {
      await start({ limitResponseTimeout: 2000 });
      const leases = mockLeaseAnswering((message, handlers) => {
        if (message.type === WORKER_EVENT.REQUEST) setTimeout(() => respond(handlers, message.requestId), 150);
      });

      const response = await postTogether('hello');

      expect(response).toContain('200 OK');
      expect(messagesOf(leases, WORKER_EVENT.REQUEST_ABORT)).toHaveLength(0);
    });
  });
  describe('websockets', () => {
    type Message = { type: string; requestId: string; event?: { body?: Buffer | string; headers?: Record<string, string> } };

    const upgraded = (handlers: Handlers, requestId: string) =>
      handlers.onMessage({
        type: WORKER_EVENT.RESPONSE,
        requestId,
        event: { statusCode: 101, headers: { Upgrade: 'websocket', Connection: 'Upgrade' }, body: Buffer.from('') },
      });

    /** a lease whose worker accepts the upgrade, or answers it with `upgrade`. `answer` reacts to the other messages. */
    const mockSocketLease = (answer: (message: Message, handlers: Handlers) => void = () => {}, upgrade = upgraded) => {
      let handlers: Handlers;
      const stream = { on: jest.fn(), off: jest.fn() };
      const lease = {
        worker: { instance: { stdout: stream, stderr: stream } },
        send: jest.fn((message: Message) =>
          setImmediate(() => {
            if (message.type === WORKER_EVENT.REQUEST) upgrade(handlers, message.requestId);
            answer(message, handlers);
          })
        ),
        subscribe: jest.fn((requestId: string, onMessage: Handlers['onMessage'], onExit: Handlers['onExit']) => {
          handlers = { onMessage, onExit };
        }),
        release: jest.fn(),
      };
      FakePool.last.acquire.mockResolvedValue(lease);

      return lease;
    };

    const messagesOf = (lease: ReturnType<typeof mockSocketLease>, type: string) =>
      lease.send.mock.calls.map(([message]) => message).filter((message) => message.type === type);

    const clients: net.Socket[] = [];
    let serverSockets: net.Socket[];

    beforeEach(() => {
      serverSockets = [];
    });

    afterEach(() => clients.splice(0).forEach((client) => client.destroy()));

    /** opens a websocket connection with the headers of an upgrade, and waits for the answer of the server */
    const connect = async (requestPath = '/') => {
      server.on('connection', (socket) => serverSockets.push(socket));
      const client = net.connect(Number(new URL(baseUrl).port), '127.0.0.1');
      clients.push(client);
      const received: Buffer[] = [];
      client.on('data', (chunk) => received.push(chunk));
      client.on('error', () => {});
      const closed = new Promise<void>((resolve) => client.on('close', () => resolve()));
      const ended = new Promise<void>((resolve) => client.on('end', () => resolve()));
      client.write(
        `GET ${requestPath} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto
          .randomBytes(16)
          .toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
      await until(() => Buffer.concat(received).includes('\r\n\r\n'));
      const head = Buffer.concat(received).toString();
      received.splice(0);

      return { client, closed, ended, head, received: () => Buffer.concat(received), write: (bytes: Buffer) => client.write(bytes) };
    };

    it('answers with what the worker answers, and passes the messages of the client on once the upgrade was accepted', async () => {
      await start();
      const lease = mockSocketLease();

      const { head, write } = await connect();
      write(Buffer.concat([clientFrame('hello'), clientFrame(Buffer.from([1, 2, 3]), { opcode: 0x2 })]));
      await until(() => messagesOf(lease, WORKER_EVENT.WS_MESSAGE_RECEIVE).length === 2);

      expect(head).toContain('101 Switching Protocols');
      expect(messagesOf(lease, WORKER_EVENT.WS_MESSAGE_RECEIVE).map(({ event }) => event)).toEqual([{ body: 'hello' }, { body: Buffer.from([1, 2, 3]) }]);
    });

    it('passes a message that comes in pieces on once, and a small one like any other', async () => {
      await start();
      const lease = mockSocketLease();

      const { write } = await connect();
      const frame = clientFrame('x'.repeat(300));
      write(frame.subarray(0, 5));
      write(frame.subarray(5, 100));
      write(frame.subarray(100));
      write(clientFrame('hi'));
      await until(() => messagesOf(lease, WORKER_EVENT.WS_MESSAGE_RECEIVE).length === 2);

      expect(messagesOf(lease, WORKER_EVENT.WS_MESSAGE_RECEIVE).map(({ event }) => event.body)).toEqual(['x'.repeat(300), 'hi']);
    });

    it('holds the client back while the worker has not taken the messages it was sent', async () => {
      await start();
      const lease = mockSocketLease();

      const { write } = await connect();
      write(Buffer.concat(Array.from({ length: WebSocketWindow.messages }, (_, index) => clientFrame(`m${index}`))));
      await until(() => serverSockets[0].isPaused());
      const [{ requestId }] = messagesOf(lease, WORKER_EVENT.REQUEST);
      lease.subscribe.mock.calls[0][1]({ type: WORKER_EVENT.WS_MESSAGE_ACKNOWLEDGE, requestId });

      expect(serverSockets[0].isPaused()).toBe(false);
    });

    it('writes the messages of the worker to the client, and acknowledges them once they are written', async () => {
      await start();
      const lease = mockSocketLease();

      const { received } = await connect();
      const [, onMessage] = lease.subscribe.mock.calls[0];
      const [{ requestId }] = messagesOf(lease, WORKER_EVENT.REQUEST);
      onMessage({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId, event: { body: 'text' } });
      onMessage({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId, event: { body: Buffer.from([7]) } });
      await until(() => received().length === 9);

      expect([...received()]).toEqual([0x81, 4, ...Buffer.from('text'), 0x82, 1, 7]);
      await until(() => messagesOf(lease, WORKER_EVENT.RESPONSE_ACKNOWLEDGE).length === 2);
    });

    it('sends the messages of the same turn in one write', async () => {
      await start();
      const lease = mockSocketLease();

      const { received } = await connect();
      const [, onMessage] = lease.subscribe.mock.calls[0];
      const [{ requestId }] = messagesOf(lease, WORKER_EVENT.REQUEST);
      Array.from({ length: 5 }, (_, index) => onMessage({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId, event: { body: `m${index}` } }));

      // held back until the turn is over, then written together
      expect(serverSockets[0].writableCorked).toBe(1);
      await until(() => received().length === 20);
      expect(serverSockets[0].writableCorked).toBe(0);
    });

    it('closes the connection when the worker says so', async () => {
      await start();
      const lease = mockSocketLease();

      const { received, ended } = await connect();
      const [, onMessage] = lease.subscribe.mock.calls[0];
      const [{ requestId }] = messagesOf(lease, WORKER_EVENT.REQUEST);
      onMessage({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId, event: { close: { code: 4000, reason: 'done' } } });
      await ended;

      expect(received().readUInt16BE(2)).toBe(4000);
      expect(received().subarray(4).toString()).toBe('done');
    });

    it('tells the worker and frees it when the client goes away', async () => {
      await start();
      const lease = mockSocketLease();

      const { client } = await connect();
      client.destroy();
      await until(() => lease.release.mock.calls.length > 0);

      expect(messagesOf(lease, WORKER_EVENT.WS_CONNECTION_CLOSE)).toHaveLength(1);
    });

    it('does not tell the worker about a closing connection for a plain request', async () => {
      await start();
      const lease = mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('ok') } })
      );

      await fetch(`${baseUrl}/`);
      server.closeAllConnections();
      await settle();

      expect(lease.send.mock.calls.filter(([message]) => message.type === WORKER_EVENT.WS_CONNECTION_CLOSE)).toHaveLength(0);
    });

    it('closes a client that breaks the protocol, and frees the worker when it is gone', async () => {
      await start();
      const lease = mockSocketLease();

      const { write, received, ended, client } = await connect();
      write(clientFrame('unmasked', { masked: false }));
      await ended;
      client.destroy();

      expect(received().readUInt16BE(2)).toBe(1002);
      await until(() => lease.release.mock.calls.length > 0);
      expect(messagesOf(lease, WORKER_EVENT.WS_MESSAGE_RECEIVE)).toHaveLength(0);
    });

    it('closes a client that sends a message above the limit', async () => {
      await start({ limitWebSocketMessage: 10 });
      mockSocketLease();

      const { write, received, ended } = await connect();
      write(clientFrame('x'.repeat(11)));
      await ended;

      expect(received().readUInt16BE(2)).toBe(1009);
    });

    it('answers 503 for the connections above the limit of a worker, and takes the next one when one is gone', async () => {
      await start({ limitWebSocketConnections: 1 });
      const lease = mockSocketLease();

      const first = await connect();
      const second = await connect();
      first.client.destroy();
      await until(() => lease.release.mock.calls.length > 0);
      const third = await connect();

      expect(first.head).toContain('101');
      expect(second.head).toContain('503');
      expect(second.head).toContain('Retry-After');
      expect(third.head).toContain('101');
    });

    it('does not count the connections of another worker', async () => {
      await start({ limitWebSocketConnections: 1 });
      mockSocketLease();
      await fs.mkdir(path.join(root, 'other'), { recursive: true });
      await fs.writeFile(path.join(root, 'other', 'exampleWorker.js'), '');

      const first = await connect('/');
      const second = await connect('/other');

      expect(first.head).toContain('101');
      expect(second.head).toContain('101');
    });

    it('gives the slot back when no worker could be had', async () => {
      await start({ limitWebSocketConnections: 1 });
      mockSocketLease();
      FakePool.last.acquire.mockRejectedValueOnce(new WorkerBusyError('/x', 'busy'));

      const first = await connect();
      const second = await connect();

      expect(first.head).toContain('503');
      expect(second.head).toContain('101');
    });

    it('frees the worker and the slot at once when the upgrade is refused', async () => {
      await start({ limitWebSocketConnections: 1 });
      const lease = mockSocketLease(undefined, (handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 400, headers: {}, body: Buffer.from('no') } })
      );

      const { head } = await connect();
      await until(() => lease.release.mock.calls.length > 0);

      expect(head).toContain('400');
    });

    it('ignores a second answer to the upgrade instead of failing', async () => {
      await start();
      const lease = mockSocketLease();

      const { client } = await connect();
      const [, onMessage] = lease.subscribe.mock.calls[0];
      const [{ requestId }] = messagesOf(lease, WORKER_EVENT.REQUEST);
      onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 101, headers: {}, body: Buffer.from('') } });
      await settle();

      expect(client.destroyed).toBe(false);
    });

    it('does not close the connection for being quiet when the keep alive timeout of the server passes', async () => {
      await start();
      server.keepAliveTimeout = 5000;
      const setTimeoutOfSocket = jest.spyOn(net.Socket.prototype, 'setTimeout');
      mockSocketLease();

      await connect();
      await until(() => setTimeoutOfSocket.mock.calls.at(-1)?.[0] === 0);

      expect(serverSockets[0].timeout).toBe(0);
      setTimeoutOfSocket.mockRestore();
    });
  });
});
