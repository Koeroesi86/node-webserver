import type { RequestHandler } from 'express';
import { middleware as workerMiddleware } from '@koeroesi86/node-worker-express';
import type { WorkerBudget } from '@koeroesi86/node-worker-express';
import compressionMiddleware from '../middlewares/compression';
import proxyMiddleware from '../middlewares/proxy';
import proxyServerMiddleware from '../middlewares/proxy-server';
import lambdaMiddleware from '../middlewares/lambda';
import getDate from './getDate';
import logger from './logger';
import trackRequests from './track-requests';
import untilIdle from './until-idle';
import type { InstanceHandler, LoadedInstance, ServerInstance } from '../types';

interface Context {
  /** shared by the worker servers, so that their processes together stay under its limit */
  workerBudget?: WorkerBudget;
  /** the server of the same entry that runs now, which this one replaces */
  previous?: LoadedInstance;
}

function getWorkerMiddleware(instance: ServerInstance, workerBudget?: WorkerBudget) {
  const { options } = instance;

  if (!options) {
    throw new Error(`options are required for worker server ${instance.hostname}.`);
  }

  return workerMiddleware({
    name: instance.hostname,
    workerBudget,
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

function getMiddleware(instance: ServerInstance, { workerBudget, previous }: Context): InstanceHandler {
  if (instance.type === 'child') {
    // the requests are counted for the child servers only, as the pools of the workers and the lambdas know which of theirs are busy themselves
    const { handler, idle } = trackRequests(proxyMiddleware(instance));
    return {
      handler,
      close: async (timeout) => {
        await untilIdle(idle, timeout);
        instance.child?.kill('SIGTERM');
        instance.proxy?.close();
      },
    };
  }
  if (instance.type === 'proxy') {
    // a target that was registered stays, as long as the server is still the one of the same host
    const samePlace = previous?.instance.hostname === instance.hostname && previous.instance.protocol === instance.protocol;
    const handler = proxyServerMiddleware(instance, samePlace ? previous.registeredTarget?.() : undefined);
    // the requests on the connections to the target are let finish by the agent, the proxy does not count them
    return { handler, close: async () => handler.close(), registeredTarget: handler.registeredTarget };
  }
  if (instance.type === 'lambda') {
    const handler = lambdaMiddleware(instance);
    // the pool stops a busy lambda once it answered, which its own timeout bounds
    return { handler, close: async () => handler.close() };
  }
  if (instance.type === 'worker') {
    const handler = getWorkerMiddleware(instance, workerBudget);
    return { handler, close: handler.close };
  }
  return {
    handler: (req, res, next) => {
      next();
    },
    close: async () => {},
  };
}

/** the handlers one after the other, like `use` on an app does */
const compose =
  (first: RequestHandler, second: RequestHandler): RequestHandler =>
  (request, response, next) =>
    first(request, response, (error?: unknown) => (error ? next(error) : second(request, response, next)));

/** starts what answers the requests of the server: the workers, the lambdas, the child process or the connections to the target of a proxy */
function createInstanceHandler(instance: ServerInstance, context: Context = {}): InstanceHandler {
  const { compression } = instance;
  const started = getMiddleware(instance, context);

  return { ...started, handler: compression ? compose(compressionMiddleware(compression === true ? {} : compression), started.handler) : started.handler };
}

export default createInstanceHandler;
