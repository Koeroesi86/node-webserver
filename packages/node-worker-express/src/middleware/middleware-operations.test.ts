import { WORKER_EVENT, WorkerAbandonedError, WorkerBusyError, WorkerUnavailableError } from '@koeroesi86/node-worker/pool';
import http from 'http';
import path from 'path';
import { getServerMetrics } from '../utils/metrics';
import { setupMiddlewareTest } from './middleware.test-helper';

jest.mock('@koeroesi86/node-worker/pool', () => require('./fake-pool.test-helper').createFakePoolModule());

const FakePool = jest.requireMock('@koeroesi86/node-worker/pool').WorkerPool;

describe('workerMiddleware', () => {
  const { t, until, settle, start, createLease, mockLease, mockLeases } = setupMiddlewareTest();

  describe('metrics', () => {
    it('answers the question of a worker for the metrics of the server', async () => {
      await start();
      const lease = mockLease((handlers, requestId) => {
        handlers.onMessage({ type: WORKER_EVENT.METRICS_REQUEST, requestId });
        setTimeout(() => handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('ok') } }), 20);
      });

      await fetch(`${t.baseUrl}/`);

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

      await fetch(`${t.baseUrl}/`);
      await new Promise((resolve) => setImmediate(resolve));

      const { sources, requests } = getServerMetrics();
      expect(sources[`workers:${t.root}`]).toMatchObject({ workers: 2, active: 1, waiting: 0, paths: {} });
      expect(requests.total - before.total).toBe(1);
      expect(requests.status['4xx'] - before.status['4xx']).toBe(1);
      expect(requests.latencyMs.count).toBeGreaterThan(0);
    });

    it('counts how long requests took per worker file, the static files under the static worker', async () => {
      await start({ name: 'latency-per-path' });
      mockLeases((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('') } })
      );

      await fetch(`${t.baseUrl}/`);
      await fetch(`${t.baseUrl}/`);
      await fetch(`${t.baseUrl}/plain/file.txt`);
      // answered without a worker, so it has no worker file to count under
      await fetch(`${t.baseUrl}/plain/missing`);
      await new Promise((resolve) => setImmediate(resolve));

      const { latencyMs } = getServerMetrics().sources['workers:latency-per-path'] as { latencyMs: Record<string, { count: number }> };
      expect(Object.entries(latencyMs).map(([workerPath, { count }]) => [path.basename(workerPath), count])).toEqual([
        ['exampleWorker.js', 2],
        ['staticWorker.js', 1],
      ]);
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

      await fetch(`${t.baseUrl}/`);
      await fetch(`${t.baseUrl}/`);

      expect(FakePool.last.params).toMatchObject({ onStdout, onStderr });
      expect(lease.worker.instance.stdout.on).not.toHaveBeenCalled();
      expect(lease.worker.instance.stderr.on).not.toHaveBeenCalled();
    });
  });

  describe('workers that keep failing', () => {
    it('answers 503 with the time to wait, without telling where the worker is', async () => {
      await start();
      FakePool.last.acquire.mockRejectedValue(new WorkerUnavailableError('/srv/secret/worker.js', 2500));

      const response = await fetch(`${t.baseUrl}/`);

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('3');
      expect(await response.text()).toBe('Service unavailable.');
    });

    it('answers 503 as well when the request waited for a worker for too long, or too many wait already', async () => {
      await start();
      FakePool.last.acquire.mockRejectedValue(
        new WorkerBusyError('/srv/secret/worker.js', 'No worker became available for /srv/secret/worker.js within 5000ms.')
      );

      const response = await fetch(`${t.baseUrl}/`);

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('1');
      expect(await response.text()).toBe('Service unavailable.');
    });

    it('asks to wait at least a second', async () => {
      await start();
      FakePool.last.acquire.mockRejectedValue(new WorkerUnavailableError('/srv/worker.js', 100));

      expect((await fetch(`${t.baseUrl}/`)).headers.get('retry-after')).toBe('1');
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
      const request = http.get(`${t.baseUrl}/`);
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

      await (await fetch(`${t.baseUrl}/`)).text();
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

      const response = await fetch(`${t.baseUrl}/`);
      await response.arrayBuffer();

      // one for the response, a second at most when it looked again
      expect(setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 777).length).toBeLessThanOrEqual(2);
    });

    it('runs out when nothing moves for as long as the limit, also after parts came in', async () => {
      await start({ limitResponseTimeout: 150 });
      mockLease((handlers, requestId) => handlers.onMessage(part(requestId, Buffer.from('first part'))));

      const response = await fetch(`${t.baseUrl}/`);

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

      const response = await fetch(`${t.baseUrl}/`);

      expect(await response.text()).toBe('part 1 part 2 part 3 part 4 part 5 part 6 part 7 part 8 ');
    });
  });
});
