import { monitorEventLoopDelay, performance } from 'perf_hooks';
import type { ServerResponse } from 'http';
import type { LatencyHistogram, LatencySnapshot } from '../types';
import createLatencyHistogram from './create-latency-histogram';

export type StatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';

/** a snapshot of the server, for health and metrics endpoints */
export type ServerMetrics = {
  uptimeSeconds: number;
  memory: { rss: number; heapTotal: number; heapUsed: number; external: number };
  /** how late the event loop of the server ran in the time since the metrics were read the last time, in milliseconds. All zero the first time. */
  eventLoopDelayMs: { mean: number; p99: number; max: number };
  /** the requests handled by the worker middleware, `active` are the ones without a complete response yet, `latencyMs` how long the ones with a closed response took */
  requests: { total: number; active: number; status: Record<StatusClass, number>; latencyMs: LatencySnapshot };
  /** what other parts of the server registered, by name: worker pools, connections, lambdas */
  sources: Record<string, unknown>;
};

const sources = new Map<string, () => unknown>();

const requests: Omit<ServerMetrics['requests'], 'latencyMs'> = { total: 0, active: 0, status: { '1xx': 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 } };

const latency = createLatencyHistogram();

/** what a tracked request is counted in besides the totals, once it is known which worker file answers it */
export type TrackedRequest = { path?: LatencyHistogram };

/** how often the delay of the event loop is sampled, in milliseconds */
const eventLoopResolution = 20;

let eventLoop: ReturnType<typeof monitorEventLoopDelay> | undefined;

/**
 * Adds something to the metrics. `read` is called whenever metrics are asked for, so it has to be cheap.
 * A second source with the same name gets a number added to it. Returns the function that removes the source again.
 */
export function registerMetricsSource(name: string, read: () => unknown) {
  const uniqueName = Array.from({ length: sources.size + 1 }, (_, index) => (index === 0 ? name : `${name}#${index + 1}`)).find(
    (candidate) => !sources.has(candidate)
  );
  sources.set(uniqueName, read);

  return () => sources.delete(uniqueName);
}

/**
 * Counts a request as active until its response is closed, and by the class of its status and how long it took after it.
 * Setting `path` of what it returns counts the time in that histogram too.
 */
export function trackRequest(response: ServerResponse): TrackedRequest {
  const startedAt = performance.now();
  const tracked: TrackedRequest = {};
  requests.total += 1;
  requests.active += 1;
  response.once('close', () => {
    const durationMs = performance.now() - startedAt;
    requests.active -= 1;
    requests.status[`${Math.floor(response.statusCode / 100)}xx`] += 1;
    latency.record(durationMs);
    tracked.path?.record(durationMs);
  });

  return tracked;
}

const readSource = (read: () => unknown) => {
  try {
    return read();
  } catch (error) {
    // one source that fails must not take the health endpoint down with it
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

const readEventLoop = (): ServerMetrics['eventLoopDelayMs'] => {
  if (eventLoop === undefined) {
    // measuring starts with the first read, so that a server that nobody asks does not pay for it
    eventLoop = monitorEventLoopDelay({ resolution: eventLoopResolution });
    eventLoop.enable();
    return { mean: 0, p99: 0, max: 0 };
  }

  // the samples are the time between two turns of the sampling timer, a loop that runs on time still takes the resolution
  const milliseconds = (nanoseconds: number) => (Number.isFinite(nanoseconds) ? Math.max(0, nanoseconds / 1e6 - eventLoopResolution) : 0);
  const result = { mean: milliseconds(eventLoop.mean), p99: milliseconds(eventLoop.percentile(99)), max: milliseconds(eventLoop.max) };
  eventLoop.reset();

  return result;
};

export function getServerMetrics(): ServerMetrics {
  const { rss, heapTotal, heapUsed, external } = process.memoryUsage();

  return {
    uptimeSeconds: process.uptime(),
    memory: { rss, heapTotal, heapUsed, external },
    eventLoopDelayMs: readEventLoop(),
    requests: { ...requests, status: { ...requests.status }, latencyMs: latency.read() },
    sources: Object.fromEntries(Array.from(sources.entries()).map(([name, read]) => [name, readSource(read)])),
  };
}
