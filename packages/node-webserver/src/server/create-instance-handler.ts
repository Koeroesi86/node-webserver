import type { RequestHandler } from 'express';
import { middleware as workerMiddleware } from '@koeroesi86/node-worker-express';
import type { WorkerBudget } from '@koeroesi86/node-worker-express';
import type { LambdaStats } from '@koeroesi86/node-lambda-invoke';
import {
  compression as compressionMiddleware,
  lambda as lambdaMiddleware,
  proxy as proxyMiddleware,
  proxyServer as proxyServerMiddleware,
  sharedChild,
} from '../middlewares';
import { createErrorPagesHandler, createRulesHandler } from '../routing';
import { createHstsHandler } from '../tls';
import { labelLine } from '../utils';
import { getTargetKey } from '../proxy';
import { trackRequests } from '../observability';
import { untilIdle } from '../lifecycle';
import type {
  CompressionBudget,
  Configuration,
  InstanceHandler,
  LoadedInstance,
  Logger,
  ServerConfig,
  ServerRuntime,
  SharedApps,
  SharedTargets,
} from '../types';

interface Context {
  logger: Logger;
  /** shared by the worker servers, so that their processes together stay under its limit */
  workerBudget?: WorkerBudget;
  /** shared by the lambda servers, for the stats of the server */
  lambdaStats?: LambdaStats;
  /** shared by the servers that compress, so that their `concurrency` counts the responses of all of them */
  compressionBudget?: CompressionBudget;
  /** the server of the same entry that runs now, which this one replaces */
  previous?: LoadedInstance;
  /** set in a front process: the registered targets, which all fronts have */
  sharedTargets?: SharedTargets;
  /** set in a front process: the applications of the `child` servers, which the primary runs */
  sharedApps?: SharedApps;
  /** of the files of the server */
  fingerprint?: string;
  configuration?: Partial<Configuration>;
}

const discard = () => {};

function getWorkerMiddleware(instance: ServerConfig, logger: Logger, workerBudget?: WorkerBudget) {
  const { options } = instance;

  if (!options) {
    throw new Error(`options are required for worker server ${instance.hostname}.`);
  }

  /** logs a line of a worker and hands it to the callback of the options. Without both no lines are built. */
  const lineListener = (level: 'info' | 'error', callback?: (line: string) => void) => {
    if (!logger.isEnabled(level)) return callback;

    return (line: string) => {
      logger[level](labelLine(instance.hostname, line));
      callback?.(line);
    };
  };

  return workerMiddleware({
    name: instance.hostname,
    workerBudget,
    ...options,
    // read whatever the levels are, as a worker would block on a full pipe
    onStdout: options.onStdout ?? discard,
    onStderr: options.onStderr ?? discard,
    onStdoutLine: lineListener('info', options.onStdoutLine),
    onStderrLine: lineListener('error', options.onStderrLine),
  });
}

/** the application of a `child` server: one that this process starts, or one that the primary starts for all its fronts */
function startChild(instance: ServerConfig, runtime: ServerRuntime, { logger, sharedApps, fingerprint, configuration }: Context) {
  if (sharedApps) {
    const shared = sharedChild(instance, { apps: sharedApps, fingerprint, portLookup: configuration?.portLookup, logger });
    runtime.appPid = shared.pid;
    return shared;
  }

  const handler = proxyMiddleware(instance, runtime, logger);
  return {
    handler,
    close: () => {
      runtime.child?.kill('SIGTERM');
      runtime.proxy?.close();
    },
  };
}

function getMiddleware(instance: ServerConfig, runtime: ServerRuntime, context: Context): InstanceHandler {
  const { logger, workerBudget, lambdaStats, previous, sharedTargets } = context;
  if (instance.type === 'child') {
    const child = startChild(instance, runtime, context);
    // the requests are counted for the child servers only, as the pools of the workers and the lambdas know which of theirs are busy themselves
    const { handler, idle } = trackRequests(child.handler);
    return {
      handler,
      close: async (timeout) => {
        await untilIdle(idle, timeout);
        child.close();
      },
    };
  }
  if (instance.type === 'proxy') {
    // a target that was registered stays, as long as the server is still the one of the same host
    const samePlace = previous?.instance.hostname === instance.hostname && previous.instance.protocol === instance.protocol;
    const key = getTargetKey(instance);
    const shared = sharedTargets && key ? { targets: sharedTargets, key } : undefined;
    const handler = proxyServerMiddleware(instance, logger, samePlace ? previous.registeredTarget?.() : undefined, shared);
    // the requests on the connections to the target are let finish by the agent, the proxy does not count them
    return { handler, close: async () => handler.close(), registeredTarget: handler.registeredTarget };
  }
  if (instance.type === 'lambda') {
    const handler = lambdaMiddleware(instance, logger, lambdaStats);
    // the pool stops a busy lambda once it answered, which its own timeout bounds
    return { handler, close: async () => handler.close() };
  }
  if (instance.type === 'worker') {
    const handler = getWorkerMiddleware(instance, logger, workerBudget);
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
function createInstanceHandler(instance: ServerConfig, runtime: ServerRuntime, context: Context): InstanceHandler {
  const { compression, errorPages, hsts, protocol, rules } = instance;
  const started = getMiddleware(instance, runtime, context);
  const compress = compression ? compressionMiddleware(compression === true ? {} : compression, context.compressionBudget) : undefined;
  const addHsts = hsts && protocol === 'https' ? createHstsHandler(hsts) : undefined;
  // after HSTS, so that a redirect carries it, and before the compression, which a redirect or a 400 has no use for
  const applyRules = rules?.length ? createRulesHandler(rules) : undefined;
  // inside the compression, so that the page is what gets compressed, and outside the server, whose answers it replaces
  const applyErrorPages = errorPages && Object.keys(errorPages).length ? createErrorPagesHandler(errorPages) : undefined;
  const handlers = [addHsts, applyRules, compress, applyErrorPages, started.handler].filter((handler) => handler !== undefined);

  return { ...started, handler: handlers.reduceRight((next, handler) => compose(handler, next)) };
}

export default createInstanceHandler;
