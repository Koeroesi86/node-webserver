import type { LogLevels } from './logger';
import type { ServerConfig } from './server';

export interface PortLookup {
  from: number;
  to: number;
  address: string;
}

/** the addresses (CIDRs, or `loopback`, `linklocal`, `uniquelocal`) of the proxies whose forwarding headers are believed */
export type TrustedProxies = string[];

export interface Configuration {
  /** set to false to disable file logging */
  fileLogPath: string | false;
  /** how long log lines are collected before they are written to the files, in milliseconds. 0 writes every line right away. Defaults to 100. */
  fileLogFlushInterval?: number;
  logLevels?: LogLevels;
  portHttp: number;
  portHttps: number;
  /** serve HTTP/2 on the https port to the clients that offer it, the others keep getting HTTP/1.1 (and websockets) on the same port. Off by default. */
  http2?: boolean;
  /**
   * how long an idle connection of a client is kept open, in milliseconds, for both the http and the https server. Defaults to 65000, longer than what load balancers keep theirs for.
   * Node itself closes them after 5 seconds.
   */
  keepAliveTimeout?: number;
  /** the number of open connections per server after which new ones are dropped, 0 for no limit. Defaults to 10000. */
  maxConnections?: number;
  /** how many worker processes the worker servers may run together, 0 for no limit. When it is reached, an idle worker is stopped to make room for the first worker of a path. Defaults to 0. */
  workerLimit?: number;
  portLookup?: PortLookup;
  /**
   * the load balancers in front of the server, whose `X-Forwarded-*` headers are believed: for the client address, the protocol (whether a request came over HTTPS)
   * and what `proxy` servers forward. Nobody by default. A list applies to both servers, `{ http, https }` sets it per server.
   */
  trustedProxies?: TrustedProxies | { http?: TrustedProxies; https?: TrustedProxies };
  /** set to false to disable */
  statsDomain: string | false;
  statsRefreshInterval: number;
  /** server definitions, or paths to modules exporting one */
  servers: Array<string | ServerConfig>;
  /**
   * a file that answers the requests for a host that no server takes, with `421`, instead of the plain text. Its type comes from the extension, as for `errorPages`.
   * Without effect where a server has `defaultHost`. It is read when the server starts and on reload, a changed file loads the servers again.
   */
  unknownHostPage?: string;
  /** load the servers given as paths again when their files, or the certificates they point to, change. Defaults to true. */
  watchServers?: boolean;
  /**
   * how long the server waits for the requests in flight when the process is stopped (SIGINT, SIGTERM, SIGHUP), in milliseconds, before the rest is cut. Defaults to 30000.
   * It stops listening at once, tells the clients on open connections to move on, closes websockets with 1001 and stops the workers, lambdas and child processes after the requests.
   * A second signal ends the process at once, as does an uncaught exception, SIGUSR1 and SIGUSR2.
   */
  shutdownTimeout?: number;
  /** load the servers again on SIGHUP, instead of stopping. Defaults to false. */
  reloadOnSighup?: boolean;
}

export type LoggerConfiguration = Pick<Configuration, 'logLevels' | 'fileLogPath' | 'fileLogFlushInterval'>;
