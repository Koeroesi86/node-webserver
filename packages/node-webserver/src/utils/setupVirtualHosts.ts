import type { Express, RequestHandler } from 'express';
import { middleware as workerMiddleware } from '@koeroesi86/node-worker-express';
import getURL from './getURL';
import virtualHostRouter from './virtual-host-router';
import compressionMiddleware from '../middlewares/compression';
import proxyMiddleware from '../middlewares/proxy';
import lambdaMiddleware from '../middlewares/lambda';
import getDate from './getDate';
import logger from './logger';
import type { Configuration, ServerInstance } from '../types';
import type { VirtualHost } from '../types/virtual-host';

function getWorkerMiddleware(instance: ServerInstance): RequestHandler {
  const { options } = instance;

  if (!options) {
    throw new Error(`options are required for worker server ${instance.hostname}.`);
  }

  return workerMiddleware({
    name: instance.hostname,
    ...options,
    onStdout(data) {
      logger.info(`[${getDate()}] ${data.toString().trim()}`);
      if (options.onStdout) {
        options.onStdout(data);
      }
    },
    onStderr(data) {
      logger.error(`[${getDate()}] ${data.toString().trim()}`);
      if (options.onStderr) {
        options.onStderr(data);
      }
    },
  });
}

function getMiddleware(instance: ServerInstance): RequestHandler {
  if (instance.type === 'child') {
    return proxyMiddleware(instance);
  }
  if (instance.type === 'lambda') {
    return lambdaMiddleware(instance);
  }
  if (instance.type === 'worker') {
    return getWorkerMiddleware(instance);
  }
  return (req, res, next) => {
    next();
  };
}

/** the handlers one after the other, like `use` on an app does */
const compose =
  (first: RequestHandler, second: RequestHandler): RequestHandler =>
  (request, response, next) =>
    first(request, response, (error?: unknown) => (error ? next(error) : second(request, response, next)));

function getHandler(instance: ServerInstance): RequestHandler {
  const { compression } = instance;
  const middleware = getMiddleware(instance);

  return compression ? compose(compressionMiddleware(compression === true ? {} : compression), middleware) : middleware;
}

function setupVirtualHosts(instances: ServerInstance[], httpApp: Express, httpsApp: Express, Configuration: Partial<Configuration>) {
  const { portHttp, portHttps } = Configuration;
  const ports = { http: portHttp, https: portHttps };
  const hosts: Record<keyof typeof ports, VirtualHost[]> = { http: [], https: [] };

  instances.forEach((instance) => {
    const { hostname, protocol } = instance;

    if (protocol !== 'http' && protocol !== 'https') {
      logger.error(`[${getDate()}] Unknown protocol ${protocol} for ${hostname}`);
      return;
    }

    hosts[protocol].push({ hostname, handler: getHandler(instance) });
    instance.url = getURL(protocol, hostname, ports[protocol]);
    logger.system(`[${getDate()}] Server started for ${instance.url}`);
  });

  // one router per app instead of a vhost middleware per host, so that finding the host does not walk the list
  if (hosts.http.length > 0) {
    httpApp.use(virtualHostRouter(hosts.http));
  }
  if (hosts.https.length > 0) {
    httpsApp.use(virtualHostRouter(hosts.https));
  }
}

export default setupVirtualHosts;
