import type { Endpoint, WarmUpOptions } from '../types/warm-up';

/**
 * The endpoints that start a worker or a lambda on their first request: the first requests of a run would wait for the start,
 * which differs between versions on purpose (for example the pre-started static worker), and would be measured as latency.
 * They are the servers of the load test configuration, the secure one and the websocket are left out as they need more than a request.
 */
export const warmUpEndpoints: Endpoint[] = [
  { host: 'web.localhost', path: '/' },
  { host: 'web.localhost', path: '/static/index.html' },
  { host: 'web.localhost', path: '/cpu/?rounds=1' },
  { host: 'web.localhost', path: '/stream/?chunks=1&size=1' },
  { host: 'lambda.localhost', path: '/index.html' },
  { host: 'compressed.localhost', path: '/' },
  { host: 'upload.localhost', path: '/', method: 'POST', body: 'warm-up' },
  { host: 'health.localhost', path: '/health' },
];

export const defaultWarmUp: WarmUpOptions = { requests: 20, attempts: 60, intervalMs: 250 };

/** an endpoint is ready when it answers with anything but a server error */
export const warmUpMaxStatus = 500;
