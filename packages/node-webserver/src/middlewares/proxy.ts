import { spawn } from 'child_process';
import type { RequestHandler } from 'express';

import { getFreePort } from '../utils';
import { PROXY_PROTOCOLS } from '../constants';
import proxyServerMiddleware from './proxy-server';
import type { Logger, ServerConfig, ServerRuntime } from '../types';

const proxyMiddleware = (instance: ServerConfig, runtime: ServerRuntime, logger: Logger): RequestHandler => {
  const { childOptions, proxyOptions, serverOptions } = instance;

  if (!childOptions || !proxyOptions || !serverOptions) {
    throw new Error('childOptions, proxyOptions and serverOptions are required for child servers.');
  }

  const { command, args } = childOptions;
  let childArgs = typeof args === 'function' ? undefined : args;

  if (!proxyOptions.hostname) {
    proxyOptions.hostname = 'localhost';
  }

  if (!proxyOptions.port) {
    const port = getFreePort();
    proxyOptions.port = port;

    childArgs = (typeof args === 'function' ? args(port) : args)?.map((childArg) => childArg.replace(/%PORT%/gi, `${port}`));

    serverOptions.proxyTarget = `${PROXY_PROTOCOLS[serverOptions.protocol]}://${proxyOptions.hostname}:${port}`;
  }

  runtime.child = spawn(command, childArgs || [], { stdio: 'pipe' });

  // the requests go the way those of a `proxy` server with a fixed target do (websockets, 502 and 504, forwarded headers), without a control path
  const proxy = proxyServerMiddleware({ ...instance, proxyOptions: { ...proxyOptions, target: serverOptions.proxyTarget, dynamic: undefined } }, logger);
  runtime.proxy = proxy;

  return proxy;
};

export default proxyMiddleware;
