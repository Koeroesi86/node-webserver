import { WORKER_EVENT } from '@koeroesi86/node-worker/pool';
import fs from 'fs/promises';
import http from 'http';
import net from 'net';
import path from 'path';
import { getServerMetrics } from '../utils';
import workerMiddleware from './index';
import { setupMiddlewareTest, type Handlers } from './middleware.test-helper';

jest.mock('@koeroesi86/node-worker/pool', () => require('./fake-pool.test-helper').createFakePoolModule());

const FakePool = jest.requireMock('@koeroesi86/node-worker/pool').WorkerPool;

describe('workerMiddleware', () => {
  const { t, until, settle, start, mockLease, mockLeases } = setupMiddlewareTest();

  it('answers with what the worker responds with and frees the worker', async () => {
    await start();
    const lease = mockLease((handlers, requestId) =>
      handlers.onMessage({
        type: WORKER_EVENT.RESPONSE,
        requestId,
        event: { statusCode: 201, headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('hello') },
      })
    );

    const response = await fetch(`${t.baseUrl}/`);

    expect(response.status).toBe(201);
    expect(await response.text()).toBe('hello');
    await new Promise((resolve) => setImmediate(resolve));
    expect(lease.release).toHaveBeenCalled();
  });

  it('answers 502 and frees the worker when the worker exits during the request', async () => {
    await start();
    const lease = mockLease((handlers) => handlers.onExit(1));

    const response = await fetch(`${t.baseUrl}/`);

    expect(response.status).toBe(502);
    expect(lease.release).toHaveBeenCalled();
  });

  it('answers 504 and frees the worker when the worker stays silent', async () => {
    await start({ limitResponseTimeout: 50 });
    const lease = mockLease(() => {});

    const response = await fetch(`${t.baseUrl}/`);

    expect(response.status).toBe(504);
    expect(lease.release).toHaveBeenCalled();
  });

  it('does not time out when the timeout is disabled', async () => {
    await start({ limitResponseTimeout: 0 });
    mockLease((handlers, requestId) =>
      setTimeout(() => handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('late') } }), 150)
    );

    expect(await (await fetch(`${t.baseUrl}/`)).text()).toBe('late');
  });

  it('fails the request when no worker can be provided', async () => {
    await start();
    FakePool.last.acquire.mockRejectedValue(new Error('No worker became available'));

    const response = await fetch(`${t.baseUrl}/`);

    expect(response.status).toBe(500);
    expect(await response.text()).toContain('No worker became available');
  });

  it('passes the limit per path on when acquiring a worker', async () => {
    await start({ limitPerPath: (workerPath: string) => (workerPath.endsWith('exampleWorker.js') ? 7 : 1) });
    mockLease((handlers, requestId) =>
      handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('') } })
    );

    await fetch(`${t.baseUrl}/`);

    expect(FakePool.last.acquire).toHaveBeenCalledWith(path.join(t.root, 'exampleWorker.js'), expect.anything(), 7, expect.any(AbortSignal));
  });

  describe('messages to the worker', () => {
    it('sends the request and nothing else for a plain response, which the worker does not wait for', async () => {
      await start();
      const lease = mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('hello') } })
      );

      await (await fetch(`${t.baseUrl}/`)).text();
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

      const response = await fetch(`${t.baseUrl}/`);

      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
      expect(response.headers.get('content-length')).toBe('256');
    });

    it('answers with an empty body when the worker sent none', async () => {
      await start();
      respondWith(undefined);

      const response = await fetch(`${t.baseUrl}/`);

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

      const response = await fetch(`${t.baseUrl}/`);

      expect(response.headers.get('content-length')).toBe('5');
      expect(response.headers.get('transfer-encoding')).toBeNull();
    });

    it.each(['Content-Length', 'content-length'])('keeps a %s of the worker', async (name) => {
      await start();
      respondWith({ [name]: 5 });

      expect((await fetch(`${t.baseUrl}/`)).headers.get('content-length')).toBe('5');
    });

    it('leaves a chunked answer of the worker alone', async () => {
      await start();
      respondWith({ 'Transfer-Encoding': 'chunked' });

      const response = await fetch(`${t.baseUrl}/`);

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

      await fetch(`${t.baseUrl}/`);

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

    it('gives the options of the static worker through its environment, normalized', async () => {
      await start({ static: { listDirectories: true, cacheControl: [{ extension: 'JS', value: 'long' }] } });

      const [, options] = FakePool.last.warm.mock.calls[0];

      expect(JSON.parse(options.env.NODE_WORKER_STATIC_OPTIONS)).toEqual({
        listDirectories: true,
        cacheControl: [{ extension: '.js', value: 'long' }],
        precompressed: [],
      });
    });

    it('does not touch the environment of the static worker without options', async () => {
      await start({});

      expect(FakePool.last.warm.mock.calls[0][1].env).toBeUndefined();
    });

    it('refuses options of the static worker that are not valid before it starts anything', () => {
      expect(() => workerMiddleware({ root: t.root, static: { cacheControl: [{ value: 'x' }] } })).toThrow('A cache rule needs');
    });

    it('asks for the static worker with the same options when a file is requested, so the started one is used', async () => {
      await start({ staticWorker: '/static-worker.js' });
      mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('') } })
      );

      await fetch(`${t.baseUrl}/plain/file.txt`);

      expect(FakePool.last.acquire.mock.calls[0][1]).toBe(FakePool.last.warm.mock.calls[0][1]);
    });
  });

  describe('warm paths', () => {
    it('keeps the worker file of a path warm, found the way a request finds it, with the options of a request', async () => {
      await start({ warmPaths: ['/some/page'], cwd: '/somewhere' });

      await until(() => FakePool.last.keepWarm.mock.calls.length > 0);
      const [workerPath, options, count] = FakePool.last.keepWarm.mock.calls[0];
      expect(workerPath).toBe(path.join(t.root, 'exampleWorker.js'));
      expect(options()).toMatchObject({ cwd: '/somewhere' });
      expect(count).toBe(1);
    });

    it('keeps as many workers as asked for, but not more than the limit of the path', async () => {
      await start({
        warmPaths: ['/', '/again'],
        warmWorkersPerPath: 3,
        limitPerPath: (workerPath: string) => (workerPath.endsWith('exampleWorker.js') ? 2 : 8),
      });

      await until(() => FakePool.last.keepWarm.mock.calls.length === 2);
      expect(FakePool.last.keepWarm.mock.calls.map(([, , count]) => count)).toEqual([2, 2]);
    });

    it('leaves out a path that the static worker serves', async () => {
      await start({ warmPaths: ['/plain/file.txt'], index: ['missing.js'] });

      await settle();
      expect(FakePool.last.keepWarm).not.toHaveBeenCalled();
    });
  });

  describe('request ids', () => {
    it('gives every request an id of its own, also for requests that run at the same time', async () => {
      await start();
      const leases = mockLeases((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('ok') } })
      );

      await Promise.all(Array.from({ length: 20 }, () => fetch(`${t.baseUrl}/`)));

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

      await fetch(`${t.baseUrl}/some/page`);
      const asked = access.mock.calls.length + stat.mock.calls.length;
      expect(asked).toBeGreaterThan(0);

      // the file system answers of the resolving itself are remembered for a second, the way to the path for five
      jest.spyOn(Date, 'now').mockReturnValue(now + 2000);
      await fetch(`${t.baseUrl}/some/page`);
      expect(access.mock.calls.length + stat.mock.calls.length).toBe(asked);

      jest.spyOn(Date, 'now').mockReturnValue(now + 6000);
      await fetch(`${t.baseUrl}/some/page`);
      expect(access.mock.calls.length + stat.mock.calls.length).toBeGreaterThan(asked);
    });

    it('asks only about the new part of a path for requests to many different paths below the same directory', async () => {
      await start();
      answerAll();
      const access = jest.spyOn(fs, 'access');
      await fetch(`${t.baseUrl}/scan/0`);
      const afterFirst = access.mock.calls.length;

      await Promise.all(Array.from({ length: 30 }, (_, index) => fetch(`${t.baseUrl}/scan/${index + 1}`)));

      // the question about the new path, for each of them
      expect(access.mock.calls.length - afterFirst).toBe(30);
    });

    it('sends the files that are not a worker to the static worker', async () => {
      await start();
      answer();

      await fetch(`${t.baseUrl}/plain/file.txt`);

      expect(FakePool.last.acquire).toHaveBeenCalledWith(
        expect.stringMatching(/static-worker\.js$/),
        expect.anything(),
        expect.anything(),
        expect.any(AbortSignal)
      );
    });
  });

  describe('missing paths', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('answers a missing path that no worker answers with the 404 of the static worker, without a worker', async () => {
      await start();

      const response = await fetch(`${t.baseUrl}/plain/missing.html`);

      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(response.headers.get('content-length')).toBe(String('The requested path does not exist.'.length));
      expect(await response.text()).toBe('The requested path does not exist.');
      expect(FakePool.last.acquire).not.toHaveBeenCalled();
    });

    it('answers a missing directory as well', async () => {
      await start();

      const response = await fetch(`${t.baseUrl}/plain/missing/`);

      expect(response.status).toBe(404);
      expect(FakePool.last.acquire).not.toHaveBeenCalled();
    });

    it('leaves a missing path to a static worker of its own, which may answer it in another way', async () => {
      await start({ staticWorker: '/static-worker.js' });
      mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('app') } })
      );

      const response = await fetch(`${t.baseUrl}/plain/missing.html`);

      expect(await response.text()).toBe('app');
      expect(FakePool.last.acquire).toHaveBeenCalledWith('/static-worker.js', expect.anything(), expect.anything(), expect.any(AbortSignal));
    });

    it('does not ask the file system again for a path that was missing lately, and finds a file that was added once that has expired', async () => {
      await start();
      mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('added') } })
      );
      const access = jest.spyOn(fs, 'access');
      const now = Date.now();
      const added = path.join(t.root, 'plain', 'added.html');

      expect((await fetch(`${t.baseUrl}/plain/added.html`)).status).toBe(404);
      const askedAboutAdded = () => access.mock.calls.filter(([fileName]) => fileName === added).length;
      const asked = askedAboutAdded();
      await fs.writeFile(added, 'added');

      try {
        expect((await fetch(`${t.baseUrl}/plain/added.html`)).status).toBe(404);
        expect(askedAboutAdded()).toBe(asked);

        // the probe remembers its answers for a second
        jest.spyOn(Date, 'now').mockReturnValue(now + 1500);
        expect(await (await fetch(`${t.baseUrl}/plain/added.html`)).text()).toBe('added');
        expect(askedAboutAdded()).toBeGreaterThan(asked);
      } finally {
        await fs.rm(added);
      }
    });

    it('reads and drops the body of a request to a missing path', async () => {
      await start();
      const connections: net.Socket[] = [];
      t.server.on('connection', (socket) => connections.push(socket));

      const status = await new Promise<number>((resolve, reject) => {
        const request = http.request(`${t.baseUrl}/plain/missing.html`, { method: 'POST' }, (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        });
        request.on('error', reject);
        request.end(Buffer.alloc(20 * 1024 * 1024));
      });

      expect(status).toBe(404);
      // the whole upload is taken from the connection, which otherwise could not be used for the next request
      await until(() => connections[0].bytesRead >= 20 * 1024 * 1024);
      expect(FakePool.last.acquire).not.toHaveBeenCalled();
    });
  });

  describe('routes', () => {
    const answer = () => mockLease((handlers, requestId) => respond(handlers, requestId));
    const respond = (handlers: Handlers, requestId: string) =>
      handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('ok') } });
    const routes = [
      { path: '/exact', worker: 'routed.js' },
      { pattern: '/items/(?<id>[0-9]+)', worker: 'routed.js' },
    ];
    const acquired = () => FakePool.last.acquire.mock.calls.map(([workerPath]: [string]) => workerPath);

    beforeAll(() => fs.writeFile(path.join(t.root, 'routed.js'), ''));

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('sends a request whose path matches to the worker of the route, without asking the file system', async () => {
      await start({ routes });
      answer();
      const access = jest.spyOn(fs, 'access');
      const stat = jest.spyOn(fs, 'stat');

      expect((await fetch(`${t.baseUrl}/exact`)).status).toBe(200);
      expect((await fetch(`${t.baseUrl}/items/12?full=1`)).status).toBe(200);

      expect(acquired()).toEqual([path.join(t.root, 'routed.js'), path.join(t.root, 'routed.js')]);
      expect(access).not.toHaveBeenCalled();
      expect(stat).not.toHaveBeenCalled();
    });

    it('hands the named groups of the pattern to the worker', async () => {
      await start({ routes });
      const lease = answer();

      await fetch(`${t.baseUrl}/items/12?full=1`);
      await fetch(`${t.baseUrl}/exact`);

      const [first, second] = lease.send.mock.calls.map(([message]) => message.event);
      expect(first).toMatchObject({ path: '/items/12', pathParameters: { id: '12' }, queryStringParameters: { full: '1' } });
      expect(second).not.toHaveProperty('pathParameters');
    });

    it('looks for the worker under the root when no route matches', async () => {
      await start({ routes });
      answer();

      await fetch(`${t.baseUrl}/items/twelve`);

      expect(acquired()).toEqual([path.join(t.root, 'exampleWorker.js')]);
    });

    it('answers 404 itself when no route matches and it may not look under the root', async () => {
      await start({ routes, fallthrough: false });
      answer();

      const response = await fetch(`${t.baseUrl}/items/twelve`);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not found.');
      expect(FakePool.last.acquire).not.toHaveBeenCalled();
    });

    it('checks for forbidden paths before the routes', async () => {
      const onForbiddenPath = jest.fn((request, response) => response.status(403).end());
      await start({ routes: [{ pattern: '/.*', worker: 'routed.js' }], onForbiddenPath });
      answer();

      // a url would have the `..` resolved before it is sent
      const status = await new Promise((resolve) =>
        http.get({ host: 'localhost', port: new URL(t.baseUrl).port, path: '/items/../exact' }, (response) => resolve(response.statusCode))
      );

      expect(status).toBe(403);
      expect(FakePool.last.acquire).not.toHaveBeenCalled();
    });

    it('refuses routes that are not valid when it is created', () => {
      expect(() => workerMiddleware({ root: t.root, routes: [{ path: '/missing', worker: 'missing.js' }] })).toThrow(/is not a file/);
    });
  });

  it('stops its workers and leaves the metrics when it is closed', async () => {
    const middleware = workerMiddleware({ root: t.root, name: 'closed.localhost' });
    const pool = FakePool.last;

    expect(getServerMetrics().sources['workers:closed.localhost']).toBeDefined();

    await middleware.close(1000);

    expect(pool.dispose).toHaveBeenCalledWith(1000);
    expect(getServerMetrics().sources['workers:closed.localhost']).toBeUndefined();
  });
});
