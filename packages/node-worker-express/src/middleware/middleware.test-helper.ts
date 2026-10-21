import { WORKER_EVENT } from '@koeroesi86/node-worker/pool';
import express from 'express';
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import workerMiddleware from './index';

export type Handlers = { onMessage: (message: unknown) => void; onExit: (code: number | null) => void };

/** Registers the hooks of a test of the middleware in the describe it is called in: a folder with a worker file, and a server that each test starts with `start`. */
export const setupMiddlewareTest = () => {
  const FakePool = jest.requireMock('@koeroesi86/node-worker/pool').WorkerPool;
  const t = { root: '', server: http.createServer(), baseUrl: '' };

  beforeAll(async () => {
    t.root = await fs.mkdtemp(path.join(os.tmpdir(), 'middleware-'));
    await fs.writeFile(path.join(t.root, 'exampleWorker.js'), '');
    await fs.mkdir(path.join(t.root, 'plain'));
    await fs.writeFile(path.join(t.root, 'plain', 'file.txt'), 'plain');
  });

  afterAll(() => fs.rm(t.root, { recursive: true, force: true }));

  afterEach(() => new Promise((resolve) => t.server.close(resolve)));

  const until = async (condition: () => boolean) => {
    for (let waited = 0; !condition() && waited < 3000; waited += 5) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(condition()).toBe(true);
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

  const start = async (options = {}) => {
    const app = express();
    const middleware = workerMiddleware({ root: t.root, index: ['exampleWorker.js'], limitResponseTimeout: 200, ...options });
    app.use(middleware);
    app.use((error, request, response, next) => response.status(500).send(`${error.message}`));
    t.server = http.createServer(app);
    await new Promise<void>((resolve) => t.server.listen(0, resolve));
    t.baseUrl = `http://localhost:${(t.server.address() as { port: number }).port}`;

    return middleware;
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

  return { t, until, settle, start, createLease, mockLease, mockLeases };
};
