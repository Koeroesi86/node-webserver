import type { Agent } from 'http';

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

export interface ProxyOptions {
  /** `proxy` servers: where the requests go, a URL. A `child` server gets its target from the port of its process */
  target?: string;
  /** `proxy` servers: sends the host of the target instead of the one of the client */
  changeOrigin?: boolean;
  /** `proxy` servers: false to accept a certificate of an https target that is not valid */
  secure?: boolean;
  /** `proxy` servers: how long the target may stay silent, in milliseconds */
  proxyTimeout?: number;
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
