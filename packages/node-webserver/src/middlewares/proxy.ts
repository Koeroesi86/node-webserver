import { spawn } from 'child_process';
import type { RequestHandler } from 'express';

/** https://github.com/nodejitsu/node-http-proxy */
import httpProxy from 'http-proxy';

import { getFreePort } from '../utils/ports';
import { PROXY_PROTOCOLS } from '../constants';
import type { ServerInstance } from '../types';

const proxyMiddleware = (instance: ServerInstance): RequestHandler => {
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

  instance.child = spawn(command, childArgs || [], { stdio: 'pipe' });
  instance.proxy = httpProxy.createProxyServer(proxyOptions);
  const { proxy } = instance;

  return (req, res) => {
    proxy.web(req, res, { target: serverOptions.proxyTarget });
  };
};

export default proxyMiddleware;
