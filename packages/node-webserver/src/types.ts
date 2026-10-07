import type { ChildProcess } from 'child_process';
import type { SecureContext } from 'tls';
import type HttpProxy from 'http-proxy';
import type { middleware } from '@koeroesi86/node-worker-express';

export type WorkerOptions = Parameters<typeof middleware>[0];

export type ServerType = 'child' | 'lambda' | 'worker';

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

export interface ProxyOptions extends HttpProxy.ServerOptions {
  hostname?: string;
  port?: number | number[];
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
  /** how many lambdas may run in total. Defaults to the number of CPU cores, 0 means no limit. */
  limit?: number;
  /** how long a request waits for a lambda when the limit is reached before it is answered with 503, in milliseconds. Defaults to 10000. */
  acquireTimeout?: number;
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

export interface Configuration {
  /** set to false to disable file logging */
  fileLogPath: string | false;
  /** how long log lines are collected before they are written to the files, in milliseconds. 0 writes every line right away. Defaults to 100. */
  fileLogFlushInterval?: number;
  logLevels?: LogLevels;
  portHttp: number;
  portHttps: number;
  portLookup?: PortLookup;
  /** set to false to disable */
  statsDomain: string | false;
  statsRefreshInterval: number;
  /** server definitions, or paths to modules exporting one */
  servers: Array<string | ServerInstance>;
}

export interface StorageDriver {
  save: (path: string, data: string) => Promise<void>;
  restore: (path: string) => Promise<string>;
  destroy: (path: string) => Promise<void>;
}
