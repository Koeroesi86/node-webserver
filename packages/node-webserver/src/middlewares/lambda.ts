import type { IncomingMessage, ServerResponse } from 'http';
import { httpMiddleware } from '@koeroesi86/node-lambda-invoke';
import type { HttpMiddleware } from '@koeroesi86/node-lambda-invoke';
import logger from '../utils/logger';
import type { LambdaOptions, ServerConfig } from '../types';
import createLambdaRouteTable from './lambda-route-table';

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

const createFallbackLambda = (config: LambdaOptions | undefined) =>
  config?.lambda ? createLambda(config, config.lambda, config.handler, config.limit) : undefined;

const dispatchRequest =
  (match: ReturnType<typeof createLambdaRouteTable>, fallback: HttpMiddleware | undefined): ((request: IncomingMessage, response: ServerResponse) => void) =>
  (request, response) => {
    const found = match(pathnameOf(request));
    if (found) return found.target.handle(request, response, found.pathParameters);
    if (fallback) return fallback.handle(request, response);
    notFound(response);
  };

const closeLambdas = (started: HttpMiddleware[]) => started.forEach((route) => route.close());

const lambdaMiddleware = (instance: ServerConfig): LambdaHandler => {
  const { lambdaOptions: config } = instance;
  const routes = config?.routes ?? [];

  if (routes.length === 0) {
    return createLambda(config, config?.lambda || '', config?.handler, config?.limit);
  }

  // the routes are matched before a lambda is taken, and each one has the pool and so the limit of its own lambda and handler
  const started: HttpMiddleware[] = [];
  try {
    const match = createLambdaRouteTable(routes, ({ lambda, handler, limit }) => createLambda(config, lambda, handler, limit ?? config?.limit), started);
    const fallback = createFallbackLambda(config);
    if (fallback) started.push(fallback);

    return Object.assign(dispatchRequest(match, fallback), { close: () => closeLambdas(started) });
  } catch (error) {
    closeLambdas(started);
    throw error;
  }
};

export default lambdaMiddleware;
