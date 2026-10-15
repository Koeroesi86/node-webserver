import type { ChildProcess } from 'child_process';
import type { SecureContext } from 'tls';
import type { middleware } from '@koeroesi86/node-worker-express';
import type { CompressionOptions } from './compression';
import type { LambdaOptions } from './lambda';
import type { ProxyOptions } from './proxy';

export type WorkerOptions = Parameters<typeof middleware>[0];

export type ServerType = 'child' | 'lambda' | 'proxy' | 'worker';

export interface ChildOptions {
  command: string;
  args?: string[] | ((port: number[]) => string[]);
}

export interface InstanceServerOptions {
  protocol: string;
  proxyTarget?: string;
  url?: string;
}

export interface ServerConfig {
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
}

/** what a server gets while it runs, set by the setup steps: the virtual host (`url`), the certificates, the child process, the proxy and the lambdas */
export interface ServerRuntime {
  url?: string;
  secureContext?: SecureContext;
  child?: ChildProcess;
  /** the connections to the target of a `child` server, closed when it stops */
  proxy?: { close: () => void };
  lambdas?: Record<string, { pid: number }>;
}
