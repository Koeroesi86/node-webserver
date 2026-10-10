import type { ChildProcess } from 'child_process';
import type { RequestHandler } from 'express';
import type { Agent } from 'http';
import type { SecureContext } from 'tls';
import type HttpProxy from 'http-proxy';
import type { middleware } from '@koeroesi86/node-worker-express';

export type WorkerOptions = Parameters<typeof middleware>[0];

export type ServerType = 'child' | 'lambda' | 'proxy' | 'worker';

export interface PortLookup {
  from: number;
  to: number;
  address: string;
}

export interface LogLevels {
  system?: boolean;
  info?: boolean;
  success?: boolean;
  error?: boolean;
  warning?: boolean;
}

export interface ChildOptions {
  command: string;
  args?: string[] | ((port: number[]) => string[]);
}

/**
 * What a `proxy` server tells its target about the client:
 * - `sanitize`: the forwarding headers are believed only from a trusted proxy (`trustedProxies`), otherwise they are replaced by the real connection,
 * - `pass`: the headers of the client go on untouched, for a target that needs the original chain and does not trust it blindly,
 * - `none`: no forwarding headers at all, for a target that should not learn who is in front of it.
 */
export type ForwardedHeaders = 'sanitize' | 'pass' | 'none';

/** a target of a `proxy` server that the service behind it registers itself, like a dyndns update */
export interface DynamicTargetOptions {
  /** the token of this host, prefer `tokenEnv` to keep it out of the configuration */
  token?: string;
  /** the name of the environment variable that holds the token of this host */
  tokenEnv?: string;
  /** seconds after which a target that was not set again expires, and requests are answered with 503. No expiry by default. */
  ttl?: number;
  /** the path of the host that is answered by the server instead of the target. Defaults to /.well-known/node-webserver/proxy */
  controlPath?: string;
  /** the protocol of a target that is registered without one. Defaults to http. */
  protocol?: 'http' | 'https';
  /** the port of a target that is registered without one */
  port?: number;
  /** let a target be a loopback, private or link-local address, for a LAN. Off by default. */
  allowPrivate?: boolean;
  /** a file the target is kept in, so that it survives a restart (still expiring by the ttl). Not kept by default. */
  persistPath?: string;
}

export interface ProxyOptions extends HttpProxy.ServerOptions {
  hostname?: string;
  port?: number | number[];
  /** `proxy` servers: the headers of the response that are not passed on to the client, for example the ones that give the provider away */
  hideHeaders?: string[];
  /** `proxy` servers: the forwarding headers sent to the target, `sanitize` by default */
  forwardedHeaders?: ForwardedHeaders;
  /** `proxy` servers: the path of a file with the certificates of the authorities the certificate of an https target is checked against */
  ca?: string;
  /** `proxy` servers: a target registered by the service itself, instead of a fixed `target` */
  dynamic?: DynamicTargetOptions;
}

/** where a `proxy` server sends its requests to, and since when */
export interface ProxyTarget {
  url: URL;
  /** keeps the connections to the target open between the requests */
  agent: Agent;
  setAt: number;
  expiresAt?: number;
}

export interface InstanceServerOptions {
  protocol: string;
  proxyTarget?: string;
  url?: string;
}

export interface LambdaOptions {
  lambda?: string;
  handler?: string;
  /** how requests and responses reach the lambda process: `ipc` (default) or through files */
  communication?: 'ipc' | 'file';
  /** how many lambdas this server may run. Defaults to the number of CPU cores, 0 means no limit. Every lambda server has a limit of its own. */
  limit?: number;
  /** how long a request waits for a lambda when the limit is reached before it is answered with 503, in milliseconds. Defaults to 10000. */
  acquireTimeout?: number;
  /** how long a lambda may take to load and start before it is stopped and the request is answered with 500, in milliseconds. Defaults to 10000. */
  startTimeout?: number;
  /** how long the handler may take to answer before the lambda is stopped and the request is answered with 504, in milliseconds. Defaults to 900000 (15 minutes). */
  timeout?: number;
  /** the largest body of a request in bytes, larger ones are answered with 413, 0 for no limit. Defaults to 6291456 (6 MiB), the payload limit of AWS. */
  limitRequestBody?: number;
  /** whether a lambda can only write to its own folders (`os.tmpdir()` is its `/tmp`) and not to the rest of the file system, as on AWS. Defaults to true. */
  restrictFileSystem?: boolean;
  /** variables of the environment of the lambdas, which get only a few of the server (`PATH`, `HOME`, `TZ`, ...) */
  env?: Record<string, string>;
}

export type CompressionEncoding = 'br' | 'gzip' | 'deflate';

export interface CompressionOptions {
  /** responses of a known size below this many bytes are sent as they are. Defaults to 1024. */
  threshold?: number;
  /** level of gzip and deflate, 1 (fast) to 9 (small). Defaults to 6. */
  level?: number;
  /** quality of brotli, 0 (fast) to 11 (small). Defaults to 4, as higher qualities are slow. */
  brotliQuality?: number;
  /** what may be used, in the order of preference when the client likes them the same. Defaults to all of them: br, gzip, deflate. */
  encodings?: CompressionEncoding[];
  /**
   * how many responses the whole process compresses at the same time, the others are sent as they are, as the threadpool of node that runs zlib also runs
   * the file system and DNS work. Defaults to 0, no limit.
   */
  concurrency?: number;
}

export interface ServerInstance {
  hostname: string;
  protocol: string;
  type?: ServerType;
  key?: string;
  cert?: string;
  ca?: string;
  options?: WorkerOptions;
  /** compress the responses of this server for the clients that accept it. Off by default. `true` uses the defaults, an object tunes them. */
  compression?: boolean | CompressionOptions;
  childOptions?: ChildOptions;
  proxyOptions?: ProxyOptions;
  serverOptions?: InstanceServerOptions;
  lambdaOptions?: LambdaOptions;
  /** populated at runtime */
  url?: string;
  secureContext?: SecureContext;
  child?: ChildProcess;
  proxy?: HttpProxy;
  lambdas?: Record<string, { pid: number }>;
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
  servers: Array<string | ServerInstance>;
  /** load the servers given as paths again when their files, or the certificates they point to, change. Defaults to true. */
  watchServers?: boolean;
  /** load the servers again on SIGHUP, instead of stopping. Defaults to false. */
  reloadOnSighup?: boolean;
}

/** what answers the requests of a server */
export interface InstanceHandler {
  handler: RequestHandler;
  /** stops what the server started once it answered the requests it took, or after `timeout` milliseconds, and resolves once it did */
  close: (timeout: number) => Promise<void>;
  /** the target that was registered with a `proxy` server, which the server that replaces it takes over */
  registeredTarget?: () => ProxyTarget | undefined;
}

/** a server of the configuration as it runs */
export interface LoadedInstance extends InstanceHandler {
  /** the entry of `servers` it comes from */
  source: string | ServerInstance;
  instance: ServerInstance;
  /** the files it was loaded from, the module and the ones it loaded, empty for a server defined in the configuration itself */
  files: string[];
  /** of the content of the files, to tell whether they changed */
  fingerprint?: string;
}

export interface StorageDriver {
  save: (path: string, data: string) => Promise<void>;
  restore: (path: string) => Promise<string>;
  destroy: (path: string) => Promise<void>;
}

/** the target of a `proxy` server that the service behind it sets */
export interface TargetStore {
  /** the target, unless none was set or it expired */
  get: () => ProxyTarget | undefined;
  set: (url: URL, expiresAt?: number) => ProxyTarget;
  unset: () => void;
  /** resolves once what was changed is in the file it is kept in */
  saved: () => Promise<void>;
  /** closes the connections to the target once the requests on them are answered, for a server that is not used any more */
  close: () => void;
}

export interface ProxyRequestOptions {
  /** send the host of the target in the `Host` header instead of the one the client asked for */
  changeOrigin?: boolean;
  /** headers of the response, in lower case, that the client does not get */
  hideHeaders?: string[];
  /** how long the target may stay silent, in milliseconds, before the request is given up with 504 */
  timeout: number;
}
