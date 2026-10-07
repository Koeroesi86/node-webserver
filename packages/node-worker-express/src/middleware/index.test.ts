import express from 'express';
import fs from 'fs/promises';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { RequestBodyWindow, WORKER_EVENT } from '../constants';
import { getServerMetrics } from '../utils/metrics';
import workerMiddleware from './index';

type Handlers = { onMessage: (message: unknown) => void; onExit: (code: number | null) => void };

jest.mock('../utils/workerPool', () => {
  class FakePool {
    static last: FakePool;
    acquire = jest.fn();
    warm = jest.fn();
    getStats = () => ({ workers: 2, active: 1, waiting: 0, paths: {} });

    constructor() {
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

    return {
      worker: {
        instance: { stdout: stream, stderr: stream },
        postMessage: jest.fn(
          (message: { type: string; requestId: string; event?: { headers: Record<string, string> } }) =>
            message.type === WORKER_EVENT.REQUEST && setImmediate(() => react(handlers, message.requestId))
        ),
      },
      subscribe: jest.fn((requestId: string, onMessage: Handlers['onMessage'], onExit: Handlers['onExit']) => {
        handlers = { onMessage, onExit };
      }),
      release: jest.fn(),
    };
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
        event: { statusCode: 201, headers: { 'Content-Type': 'text/plain' }, body: 'hello', isBase64Encoded: false },
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
      setTimeout(
        () => handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: 'late', isBase64Encoded: false } }),
        150
      )
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
      handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: '', isBase64Encoded: false } })
    );

    await fetch(`${baseUrl}/`);

    expect(FakePool.last.acquire).toHaveBeenCalledWith(path.join(root, 'exampleWorker.js'), expect.anything(), 7);
  });

  describe('messages to the worker', () => {
    it('sends the request and nothing else for a plain response, which the worker does not wait for', async () => {
      await start();
      const lease = mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: 'hello', isBase64Encoded: false } })
      );

      await (await fetch(`${baseUrl}/`)).text();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(lease.worker.postMessage.mock.calls.map(([message]) => message.type)).toEqual([WORKER_EVENT.REQUEST]);
    });
  });

  describe('response headers', () => {
    const respondWith = (headers: Record<string, string | number>) =>
      mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers, body: 'hello', isBase64Encoded: false } })
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
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: '', isBase64Encoded: false } })
      );

      await fetch(`${baseUrl}/`);

      const options = FakePool.last.acquire.mock.calls[0][1];
      expect(typeof options).toBe('function');
      expect(options()).toMatchObject({
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        cwd: '/somewhere',
        env: expect.objectContaining({ FROM_CONFIG: 'yes', PATH: process.env.PATH }),
      });
    });
  });

  describe('warming the static worker', () => {
    it('starts a static worker together with the middleware', async () => {
      await start({ staticWorker: '/static-worker.js' });

      expect(FakePool.last.warm).toHaveBeenCalledTimes(1);
      expect(FakePool.last.warm).toHaveBeenCalledWith('/static-worker.js', expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe', 'ipc'] }));
    });

    it('can be switched off', async () => {
      await start({ warmStaticWorker: false });

      expect(FakePool.last.warm).not.toHaveBeenCalled();
    });

    it('asks for the static worker with the same options when a file is requested, so the started one is used', async () => {
      await start({ staticWorker: '/static-worker.js' });
      mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: '', isBase64Encoded: false } })
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
        body: body === null ? null : body.toString('base64'),
        isBase64Encoded: body !== null,
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
      const acknowledgements = lease.worker.postMessage.mock.calls.filter(([message]) => message.type === WORKER_EVENT.RESPONSE_ACKNOWLEDGE);
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
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(lease.worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: WORKER_EVENT.REQUEST_ABORT }));
      expect(lease.release).toHaveBeenCalled();
    });

    it('does not tell the worker to stop after a complete response', async () => {
      await start();
      const lease = mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: 'done', isBase64Encoded: false } })
      );

      await (await fetch(`${baseUrl}/`)).text();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(lease.worker.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: WORKER_EVENT.REQUEST_ABORT }));
    });

    it('ends a response early when the worker stops sending parts', async () => {
      await start({ limitResponseTimeout: 50 });
      const lease = mockLease((handlers, requestId) => handlers.onMessage(part(requestId, bytes)));

      const response = await fetch(`${baseUrl}/`);

      await expect(response.arrayBuffer()).rejects.toThrow();
      expect(lease.release).toHaveBeenCalled();
    });

    it('keeps a response going while parts keep coming, even if it takes longer than the timeout', async () => {
      await start({ limitResponseTimeout: 80 });
      mockLease((handlers, requestId) => {
        const send = (index: number) => {
          handlers.onMessage(part(requestId, index < 5 ? bytes : null));
          if (index < 5) setTimeout(() => send(index + 1), 40);
        };
        send(0);
      });

      const response = await fetch(`${baseUrl}/`);

      expect((await response.arrayBuffer()).byteLength).toBe(bytes.length * 5);
    });
  });

  describe('streamed request bodies', () => {
    type Message = { type: string; requestId: string; event?: { body?: string | null; hasBody?: boolean } };

    const until = async (condition: () => boolean) => {
      for (let waited = 0; !condition() && waited < 3000; waited += 5) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(condition()).toBe(true);
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

    /** a lease whose worker is told every message that was sent to it, `answer` decides how it reacts */
    const mockUploadLease = (answer: (message: Message, handlers: Handlers) => void) => {
      let handlers: Handlers;
      const stream = { on: jest.fn(), off: jest.fn() };
      const lease = {
        worker: {
          instance: { stdout: stream, stderr: stream },
          postMessage: jest.fn((message: Message) => setImmediate(() => answer(message, handlers))),
        },
        subscribe: jest.fn((requestId: string, onMessage: Handlers['onMessage'], onExit: Handlers['onExit']) => {
          handlers = { onMessage, onExit };
        }),
        release: jest.fn(),
      };
      FakePool.last.acquire.mockResolvedValue(lease);

      return lease;
    };

    const messagesOf = (lease: ReturnType<typeof mockUploadLease>, type: string) =>
      lease.worker.postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === type);
    const bytesOf = (lease: ReturnType<typeof mockUploadLease>) =>
      Buffer.concat(
        messagesOf(lease, WORKER_EVENT.REQUEST_BODY)
          .filter(({ event }) => event.body !== null)
          .map(({ event }) => Buffer.from(event.body, 'base64'))
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
      await start();
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
      await start({ limitResponseTimeout: 2000 });
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

      expect(FakePool.last.acquire).toHaveBeenCalledWith(expect.stringMatching(/staticWorker\.js$/), expect.anything(), expect.anything());
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

      const ids = leases.flatMap(({ worker }) => worker.postMessage.mock.calls.map(([message]) => message.requestId));
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

      expect(FakePool.last.acquire).toHaveBeenCalledWith(expect.stringMatching(/staticWorker\.js$/), expect.anything(), expect.anything());
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

      const answers = lease.worker.postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === WORKER_EVENT.METRICS);
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
});
