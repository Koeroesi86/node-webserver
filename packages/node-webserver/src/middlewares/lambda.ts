import type { IncomingMessage, ServerResponse } from 'http';
import { httpMiddleware } from '@koeroesi86/node-lambda-invoke';
import type { HttpMiddleware, LambdaStats } from '@koeroesi86/node-lambda-invoke';
import type { LambdaOptions, LogFunction, ServerConfig } from '../types';
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
  log: LogFunction;
  config: LambdaOptions | undefined;
  lambda: string;
  handler: string | undefined;
  limit: number | undefined;
  stats?: LambdaStats;
}

const createLambda = ({ log, config, lambda, handler, limit, stats }: CreateLambdaParams) =>
  httpMiddleware({
    lambdaPath: lambda.replace(/\\/g, '/'),
    handlerKey: handler || 'handler',
    logger: log,
    communication: { type: config?.communication || 'ipc' },
    limit,
    acquireTimeout: config?.acquireTimeout,
    startTimeout: config?.startTimeout,
    timeout: config?.timeout,
    limitRequestBody: config?.limitRequestBody,
    restrictFileSystem: config?.restrictFileSystem,
    env: config?.env,
    stats,
  });

const createFallbackLambda = (log: LogFunction, config: LambdaOptions | undefined, stats?: LambdaStats) =>
  config?.lambda ? createLambda({ log, config, lambda: config.lambda, handler: config.handler, limit: config.limit, stats }) : undefined;

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
const lambdaMiddleware = (instance: ServerConfig, log: LogFunction, stats?: LambdaStats): LambdaHandler => {
  const { lambdaOptions: config } = instance;
  const routes = config?.routes ?? [];

  if (routes.length === 0) {
    return createLambda({ log, config, lambda: config?.lambda || '', handler: config?.handler, limit: config?.limit, stats });
  }

  // the routes are matched before a lambda is taken, and each one has the pool and so the limit of its own lambda and handler
  const started: HttpMiddleware[] = [];
  try {
    const match = createLambdaRouteTable(
      routes,
      ({ lambda, handler, limit }) => createLambda({ log, config, lambda, handler, limit: limit ?? config?.limit, stats }),
      started
    );
    const fallback = createFallbackLambda(log, config, stats);
    if (fallback) started.push(fallback);

    return Object.assign(dispatchRequest(match, fallback), { close: () => closeLambdas(started) });
  } catch (error) {
    closeLambdas(started);
    throw error;
  }
};

export default lambdaMiddleware;
