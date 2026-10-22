import type { ChildProcess } from 'child_process';
import type { SecureContext } from 'tls';
import type { middleware } from '@koeroesi86/node-worker-express';
import type { AcmeOptions } from './acme';
import type { CompressionOptions } from './compression';
import type { LambdaOptions } from './lambda';
import type { ProxyOptions } from './proxy';
import type { Rule } from './rule';

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

export interface RedirectOptions {
  /** `308` keeps the method of the request, `301` is the one old clients know. Defaults to 308. */
  status?: 301 | 308;
}

export interface HstsOptions {
  /** how long, in seconds, the browsers only use https for the host. Defaults to a year. */
  maxAge?: number;
  includeSubDomains?: boolean;
  preload?: boolean;
}

export interface ServerConfig {
  hostname: string;
  protocol: string;
  type?: ServerType;
  /** answer the requests of its protocol that no server takes (a host name that matches none, or no `Host` header) as well, like `default_server` of nginx. At most one server per protocol. Off by default. */
  defaultHost?: boolean;
  /** redirects and rewrites run before the server of the host, the first one that matches the path decides. A host without rules does no work for them. */
  rules?: Rule[];
  /** files that answer a status instead of the body of it: the key is a status code from 400 to 599, the value the file, read when the server starts and on reload. A response that is html already is left as it is. */
  errorPages?: Record<string, string>;
  /** the file of the private key. With `acme` it is where the key is written, and it defaults to a file in `acme.storagePath`. */
  key?: string;
  /** the file of the certificate (with its chain). With `acme` it is where the certificate is written, and it defaults to a file in `acme.storagePath`. */
  cert?: string;
  ca?: string;
  /** for an `https` server: get its certificate from an ACME server such as Let's Encrypt when there is none, and renew it before it expires. Off by default. */
  acme?: AcmeOptions;
  /** for an `https` server: answer the plain http requests for its host name with a redirect to https. A server of the same name on the http port answers first. Off by default. */
  redirectHttp?: boolean | RedirectOptions;
  /** for an `https` server: send `Strict-Transport-Security` with its responses. `true` uses the defaults. Off by default. */
  hsts?: boolean | HstsOptions;
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
