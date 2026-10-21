import type { LatencySnapshot } from './latency';

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
