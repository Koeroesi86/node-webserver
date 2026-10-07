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
          (message: { type: string; requestId: string }) => message.type === WORKER_EVENT.REQUEST && setImmediate(() => react(handlers, message.requestId))
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
});
