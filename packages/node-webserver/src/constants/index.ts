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

/** the path of a `proxy` host with a dynamic target that the server answers itself, for the service to register its target */
export const DEFAULT_CONTROL_PATH = '/.well-known/node-webserver/proxy';

/** how long a `proxy` server waits for its target to answer, or to send more of the answer, before it answers 504, in milliseconds */
export const DEFAULT_PROXY_TIMEOUT = 60000;

/** the control path of a host takes this many updates, and this many failed attempts from one address, per window */
export const CONTROL_RATE_WINDOW = 60000;
export const CONTROL_UPDATES_PER_WINDOW = 10;
export const CONTROL_FAILURES_PER_WINDOW = 10;

/** the largest body the control path reads, in bytes: it only ever holds a target */
export const CONTROL_BODY_LIMIT = 4096;

/** headers of one connection, which a proxy does not pass on (RFC 9110 7.6.1), `expect` included as the server already answered it */
export const HOP_BY_HOP_HEADERS = ['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'expect'];

/** headers that name the client, which only a trusted proxy may set */
export const CLIENT_ADDRESS_HEADERS = ['x-real-ip', 'x-client-ip', 'cf-connecting-ip'];
