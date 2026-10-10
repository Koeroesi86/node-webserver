import fs from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import { httpMiddleware } from '@koeroesi86/node-lambda-invoke';
import { createRouteMatcher } from '@koeroesi86/node-worker-express';
import logger from '../utils/logger';
import type { LambdaOptions, ServerInstance } from '../types';

type LambdaHandler = ((request: IncomingMessage, response: ServerResponse, next?: () => void) => void) & { close: () => void };

/** the same message and shape as the failures of the lambdas, which API Gateway answers with a JSON object */
const notFound = (response: ServerResponse) => {
  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ message: 'Not Found' }));
};

const pathnameOf = ({ url = '/' }: IncomingMessage) => {
  const queryStart = url.indexOf('?');
  return (queryStart === -1 ? url : url.slice(0, queryStart)) || '/';
};

const createLambda = (config: LambdaOptions | undefined, lambda: string, handler: string | undefined, limit: number | undefined) =>
  httpMiddleware({
    lambdaPath: lambda.replace(/\\/g, '/'),
    handlerKey: handler || 'handler',
    logger: logger.info,
    communication: { type: config?.communication || 'ipc' },
    limit,
    acquireTimeout: config?.acquireTimeout,
    startTimeout: config?.startTimeout,
    timeout: config?.timeout,
    limitRequestBody: config?.limitRequestBody,
    restrictFileSystem: config?.restrictFileSystem,
    env: config?.env,
  });

const lambdaMiddleware = (instance: ServerInstance): LambdaHandler => {
  const { lambdaOptions: config } = instance;
  const routes = config?.routes ?? [];

  if (routes.length === 0) {
    return createLambda(config, config?.lambda || '', config?.handler, config?.limit);
  }

  // the routes are matched here, before a lambda is taken, and each one has the pool and so the limit of its own lambda and handler
  const started: Array<{ close: () => void }> = [];
  try {
    const match = createRouteMatcher(routes, ({ lambda, handler, limit }, position) => {
      if (typeof lambda !== 'string' || lambda === '') {
        throw new Error(`routes[${position}] has no lambda.`);
      }
      // checked once here, so that a mistake in the configuration shows when the server starts and not with the first request for it
      if (!fs.statSync(lambda, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`The lambda of routes[${position}] is not a file: ${lambda}`);
      }
      const route = createLambda(config, lambda, handler, limit ?? config?.limit);
      started.push(route);
      return route;
    });
    // `lambda` stays what it was, a route for every request, that comes last
    const rest = config?.lambda ? createLambda(config, config.lambda, config.handler, config.limit) : undefined;
    if (rest) started.push(rest);

    return Object.assign(
      (request: IncomingMessage, response: ServerResponse) => {
        const found = match(pathnameOf(request));
        if (found) return found.target.handle(request, response, found.pathParameters);
        if (rest) return rest.handle(request, response);
        notFound(response);
      },
      { close: () => started.forEach((route) => route.close()) }
    );
  } catch (error) {
    started.forEach((route) => route.close());
    throw error;
  }
};

export default lambdaMiddleware;
