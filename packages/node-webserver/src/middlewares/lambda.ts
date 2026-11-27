import type { IncomingMessage, ServerResponse } from 'http';
import { httpMiddleware } from '@koeroesi86/node-lambda-invoke';
import type { HttpMiddleware, LambdaStats } from '@koeroesi86/node-lambda-invoke';
import type { LambdaOptions, Logger, ServerConfig } from '../types';
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

interface CreateLambdaParams {
  logger: Logger;
  /** the host of the server, which its lambdas are named with in the logs */
  hostname: string;
  config: LambdaOptions | undefined;
  lambda: string;
  handler: string | undefined;
  limit: number | undefined;
  stats?: LambdaStats;
}

const createLambda = ({ logger, hostname, config, lambda, handler, limit, stats }: CreateLambdaParams) =>
  httpMiddleware({
    lambdaPath: lambda.replace(/\\/g, '/'),
    handlerKey: handler || 'handler',
    logger: logger.info,
    label: hostname,
    // no lines are built for a level that is off
    logOutput: logger.isEnabled('info'),
    limit,
    acquireTimeout: config?.acquireTimeout,
    startTimeout: config?.startTimeout,
    timeout: config?.timeout,
    limitRequestBody: config?.limitRequestBody,
    restrictFileSystem: config?.restrictFileSystem,
    env: config?.env,
    stats,
  });

/** what all the lambdas of a server share */
type ServerLambdas = Pick<CreateLambdaParams, 'logger' | 'hostname' | 'config' | 'stats'>;

const createFallbackLambda = (shared: ServerLambdas) =>
  shared.config?.lambda ? createLambda({ ...shared, lambda: shared.config.lambda, handler: shared.config.handler, limit: shared.config.limit }) : undefined;

const dispatchRequest =
  (match: ReturnType<typeof createLambdaRouteTable>, fallback: HttpMiddleware | undefined): ((request: IncomingMessage, response: ServerResponse) => void) =>
  (request, response) => {
    const found = match(pathnameOf(request));
    if (found) return found.target.handle(request, response, found.pathParameters);
    if (fallback) return fallback.handle(request, response);
    notFound(response);
  };

const closeLambdas = (started: HttpMiddleware[]) => started.forEach((route) => route.close());

/** `stats` is where the pools of the lambdas list themselves, for the stats of the server that runs them */
const lambdaMiddleware = (instance: ServerConfig, logger: Logger, stats?: LambdaStats): LambdaHandler => {
  const { hostname, lambdaOptions: config } = instance;
  const routes = config?.routes ?? [];
  const shared = { logger, hostname, config, stats };

  if (routes.length === 0) {
    return createLambda({ ...shared, lambda: config?.lambda || '', handler: config?.handler, limit: config?.limit });
  }

  // the routes are matched before a lambda is taken, and each one has the pool and so the limit of its own lambda and handler
  const started: HttpMiddleware[] = [];
  try {
    const match = createLambdaRouteTable(
      routes,
      ({ lambda, handler, limit }) => createLambda({ ...shared, lambda, handler, limit: limit ?? config?.limit }),
      started
    );
    const fallback = createFallbackLambda(shared);
    started.push(...(fallback ? [fallback] : []));

    return Object.assign(dispatchRequest(match, fallback), { close: () => closeLambdas(started) });
  } catch (error) {
    closeLambdas(started);
    throw error;
  }
};

export default lambdaMiddleware;
