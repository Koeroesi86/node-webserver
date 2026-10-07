import { EventEmitter } from 'events';
import { getServerMetrics, registerMetricsSource, trackRequest } from './metrics';
import type { ServerResponse } from 'http';

const response = (statusCode = 200) => Object.assign(new EventEmitter(), { statusCode }) as unknown as ServerResponse;

describe('metrics', () => {
  describe('requests', () => {
    it('counts a request as active until its response is closed', () => {
      const before = getServerMetrics().requests;
      const first = response();
      const second = response();

      trackRequest(first);
      trackRequest(second);
      const during = getServerMetrics().requests;
      first.emit('close');
      const after = getServerMetrics().requests;

      expect(during.total - before.total).toBe(2);
      expect(during.active - before.active).toBe(2);
      expect(after.active - before.active).toBe(1);
      second.emit('close');
    });

    it('counts the responses by the class of their status', () => {
      const before = getServerMetrics().requests.status;
      const responses = [response(200), response(204), response(301), response(404), response(500), response(504)];

      responses.forEach((tracked) => {
        trackRequest(tracked);
        tracked.emit('close');
      });

      const after = getServerMetrics().requests.status;
      expect(['2xx', '3xx', '4xx', '5xx'].map((name) => after[name] - before[name])).toEqual([2, 1, 1, 2]);
    });

    it('does not let a caller change the counters through a snapshot', () => {
      const snapshot = getServerMetrics();
      snapshot.requests.total = -1;
      snapshot.requests.status['2xx'] = -1;

      const next = getServerMetrics().requests;

      expect(next.total).toBeGreaterThanOrEqual(0);
      expect(next.status['2xx']).toBeGreaterThanOrEqual(0);
    });
  });

  describe('process', () => {
    it('reports uptime and memory', () => {
      const { uptimeSeconds, memory } = getServerMetrics();

      expect(uptimeSeconds).toBeGreaterThan(0);
      expect(memory.rss).toBeGreaterThan(0);
      expect(memory.heapUsed).toBeGreaterThan(0);
      expect(memory.heapTotal).toBeGreaterThanOrEqual(memory.heapUsed);
    });

    it('does not count the time between two samples as delay, as a loop that runs on time still takes it', async () => {
      getServerMetrics();
      await new Promise((resolve) => setTimeout(resolve, 200));

      const { eventLoopDelayMs } = getServerMetrics();

      // 20 milliseconds is what every sample is without the correction
      expect(eventLoopDelayMs.mean).toBeLessThan(20);
    });

    it('reports how late the event loop ran since the last read, all zero for the first read', async () => {
      getServerMetrics();
      // the measuring needs a few turns to get going
      await new Promise((resolve) => setTimeout(resolve, 100));
      // block the loop for a while, which the next read has to show
      const until = Date.now() + 150;
      while (Date.now() < until);
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const { eventLoopDelayMs } = getServerMetrics();
      const afterwards = getServerMetrics().eventLoopDelayMs;

      expect(eventLoopDelayMs.max).toBeGreaterThan(100);
      expect(afterwards.max).toBeLessThan(eventLoopDelayMs.max);
    });
  });

  describe('sources', () => {
    it('includes what is registered, by name', () => {
      const unregister = registerMetricsSource('test-source', () => ({ workers: 3 }));

      expect(getServerMetrics().sources['test-source']).toEqual({ workers: 3 });
      unregister();
    });

    it('reads a source again for every snapshot', () => {
      let calls = 0;
      const unregister = registerMetricsSource('counting', () => (calls += 1));

      getServerMetrics();

      expect(getServerMetrics().sources.counting).toBe(2);
      unregister();
    });

    it('gives a second source with the same name a number', () => {
      const unregister = [
        registerMetricsSource('twice', () => 'first'),
        registerMetricsSource('twice', () => 'second'),
        registerMetricsSource('twice', () => 'third'),
      ];

      const { sources } = getServerMetrics();

      expect([sources.twice, sources['twice#2'], sources['twice#3']]).toEqual(['first', 'second', 'third']);
      unregister.forEach((remove) => remove());
    });

    it('does not include a source after it was removed, and gives its name away again', () => {
      const unregister = registerMetricsSource('temporary', () => 1);
      unregister();

      expect(getServerMetrics().sources).not.toHaveProperty('temporary');
      const again = registerMetricsSource('temporary', () => 2);
      expect(getServerMetrics().sources.temporary).toBe(2);
      again();
    });

    it('reports the error of a source that fails and still the others', () => {
      const unregister = [
        registerMetricsSource('broken', () => {
          throw new Error('not available');
        }),
        registerMetricsSource('fine', () => 'ok'),
      ];

      const { sources } = getServerMetrics();

      expect(sources.broken).toEqual({ error: 'not available' });
      expect(sources.fine).toBe('ok');
      unregister.forEach((remove) => remove());
    });
  });
});
