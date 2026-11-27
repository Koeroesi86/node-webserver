import type { RequestHandler } from 'express';

import { PROXY_PROTOCOLS } from '../constants';
import { getAppKey } from '../children';
import proxyServerMiddleware from './proxy-server';
import type { ProxyServerMiddleware } from './proxy-server';
import { getDate } from '../utils';
import type { Logger, PortLookup, ServerConfig, SharedApps } from '../types';

interface Options {
  apps: SharedApps;
  /** of the files of the server */
  fingerprint?: string;
  portLookup?: PortLookup;
  logger: Logger;
}

/**
 * A `child` server in a front: the primary starts its application, once for all fronts, and the requests are passed on to it as those of a `proxy` server. Without a port of the
 * configuration the primary picks one, and the requests that come before it said which wait for it.
 */
const sharedChildMiddleware = (
  instance: ServerConfig,
  { apps, fingerprint, portLookup, logger }: Options
): { handler: RequestHandler; close: () => void; pid: () => number | undefined } => {
  const { childOptions, proxyOptions, serverOptions } = instance;

  if (!childOptions || !proxyOptions || !serverOptions) {
    throw new Error('childOptions, proxyOptions and serverOptions are required for child servers.');
  }

  const { command, args } = childOptions;
  // a port of the configuration is for the application and its target as they are written, as for a server of one process
  const fixed = [proxyOptions.port].flat()[0] || undefined;
  const createProxy = (target?: string) => proxyServerMiddleware({ ...instance, proxyOptions: { ...proxyOptions, target, dynamic: undefined } }, logger);
  const fillPort = (port: number) => (typeof args === 'function' ? args([port]) : args)?.map((argument) => argument.replace(/%PORT%/gi, `${port}`)) ?? [];
  // at once where it can be, so that what is wrong with it stops the load of the servers
  let proxy: ProxyServerMiddleware | undefined = fixed ? createProxy(serverOptions.proxyTarget) : undefined;
  let closed = false;
  const key = getAppKey(instance, fingerprint);

  const started = apps.claim(key, { port: fixed, lookup: portLookup }).then((port) => {
    if (closed) return;

    const asWritten = Array.isArray(args) ? args : [];
    apps.start(key, command, fixed ? asWritten : fillPort(port));
    proxy ??= createProxy(`${PROXY_PROTOCOLS[serverOptions.protocol]}://${proxyOptions.hostname || 'localhost'}:${port}`);
  });
  started.catch((error) => logger.error(`[${getDate()}] The application of ${instance.hostname} cannot be started:`, error));

  return {
    handler: (request, response, next) => {
      if (proxy) return proxy(request, response, next);
      started.then(() => proxy?.(request, response, next)).catch(next);
    },
    close: () => {
      closed = true;
      proxy?.close();
      apps.release(key);
    },
    pid: () => apps.pid(key),
  };
};

export default sharedChildMiddleware;
