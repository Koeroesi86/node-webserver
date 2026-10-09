import vHost from 'vhost';
import type { Express, IRouter, RequestHandler } from 'express';
import { middleware as workerMiddleware } from '@koeroesi86/node-worker-express';
import getURL from './getURL';
import compressionMiddleware from '../middlewares/compression';
import proxyMiddleware from '../middlewares/proxy';
import lambdaMiddleware from '../middlewares/lambda';
import getDate from './getDate';
import logger from './logger';
import type { Configuration, ServerInstance } from '../types';

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

function setupVirtualHost(instance: ServerInstance, httpApp: Express, httpsApp: IRouter, Configuration: Partial<Configuration>) {
  const { portHttp, portHttps } = Configuration;
  const { hostname, protocol } = instance;

  switch (protocol) {
    case 'http':
      httpApp.use(vHost(hostname, getHandler(instance)));
      instance.url = getURL(protocol, hostname, portHttp);
      logger.system(`[${getDate()}] Server started for ${instance.url}`);
      break;
    case 'https':
      httpsApp.use(vHost(hostname, getHandler(instance)));
      instance.url = getURL(protocol, hostname, portHttps);
      logger.system(`[${getDate()}] Server started for ${instance.url}`);
      break;
    default:
      logger.error(`[${getDate()}] Unknown protocol ${protocol} for ${hostname}`);
  }

  return instance;
}

function setupVirtualHosts(instances: ServerInstance[], httpApp: Express, httpsApp: IRouter, Configuration: Partial<Configuration>) {
  instances.forEach((instance) => setupVirtualHost(instance, httpApp, httpsApp, Configuration));
}

export default setupVirtualHosts;
