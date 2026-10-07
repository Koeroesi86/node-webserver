import express from 'express';
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { WORKER_EVENT } from '../constants';
import workerMiddleware from './index';

type Handlers = { onMessage: (message: unknown) => void; onExit: (code: number | null) => void };

jest.mock('../utils/workerPool', () => {
  class FakePool {
    static last: FakePool;
    acquire = jest.fn();
    warm = jest.fn();

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
  const mockLease = (react: (handlers: Handlers, requestId: string) => void) => {
    let handlers: Handlers;
    const stream = { on: jest.fn(), off: jest.fn() };
    const lease = {
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
    FakePool.last.acquire.mockResolvedValue(lease);

    return lease;
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
});
