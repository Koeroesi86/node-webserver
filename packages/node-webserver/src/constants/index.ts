import { resolve } from 'path';

/** folder of the package, both from src/ and dist/ */
export const PACKAGE_ROOT = resolve(__dirname, '../..');

export const DEFAULT_PORTS: Record<string, number> = {
  http: 80,
  https: 443,
};

export const PROXY_PROTOCOLS: Record<string, string> = {
  http: 'http',
  https: 'http',
  ws: 'ws',
  wss: 'ws',
};

/**
 * Node closes an idle keep-alive connection after 5 seconds, which is shorter than what load balancers and proxies keep theirs for (60 seconds is common),
 * and they then send a request on a connection that has just been closed. Longer than their timeout avoids that.
 */
export const DEFAULT_KEEP_ALIVE_TIMEOUT = 65000;

/** the open connections of a server after which new ones are dropped, 0 for no limit */
export const DEFAULT_MAX_CONNECTIONS = 10000;
