import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { availableParallelism } from 'os';
import RequestBodyTooLargeError from '../classes/RequestBodyTooLargeError';
import { DEFAULT_LIMIT_REQUEST_BODY, DEFAULT_START_TIMEOUT, DEFAULT_TIMEOUT } from '../constants';
import answerFailure from '../utils/answer-failure';
import answerOutcome from '../utils/answer-outcome';
import createLambdaPool from '../utils/create-lambda-pool';
import createLambdaStatsSource from '../utils/create-lambda-stats-source';
import createWorkerRequestEvent from '../utils/create-worker-request-event';
import invokeLambda from '../utils/invoke-lambda';
import sweepLambdaFolders from '../utils/sweep-lambda-folders';
import { defaultLambdaStats } from '../utils/get-lambda-stats';
import type { HttpMiddlewareOptions } from '../types';

/**
 * the middleware, `handle`, which answers a request with `pathParameters` for the event (for a caller that routes requests to several middlewares and knows more about the path than the lambda),
 * and `close`, which stops its lambdas once they answered, for a server that is not used any more
 */
export type HttpMiddleware = ((request: IncomingMessage, response: ServerResponse, next?: () => void) => void) & {
  handle: (request: IncomingMessage, response: ServerResponse, pathParameters?: Record<string, string>) => void;
  close: () => void;
};

/** a path limit that is never reached, for a middleware without a limit: the pool keeps a single worker for a limit of 0 */
const NO_LIMIT = Number.MAX_SAFE_INTEGER;

function createHttpMiddleware(options: HttpMiddlewareOptions): HttpMiddleware {
  const {
    lambdaPath,
    handlerKey = 'handler',
    logger = () => {},
    limit = availableParallelism(),
    acquireTimeout = 10000,
    startTimeout = DEFAULT_START_TIMEOUT,
    timeout = DEFAULT_TIMEOUT,
    limitRequestBody = DEFAULT_LIMIT_REQUEST_BODY,
    env,
    restrictFileSystem = true,
    stats = defaultLambdaStats,
  } = options;

  sweepLambdaFolders();
  const pool = createLambdaPool({ lambdaPath, handlerKey, limit, acquireTimeout, startTimeout, timeout, restrictFileSystem, env, logger });
  const statsSource = createLambdaStatsSource(lambdaPath, pool);
  stats.add(statsSource);

  const handle = (request: IncomingMessage, response: ServerResponse, pathParameters?: Record<string, string>) => {
    const requestId = randomUUID();

    logger('Invoking lambda', `${lambdaPath}#${handlerKey}`);

    // a client that goes away while its request waits for a lambda leaves the line, instead of taking a lambda that nobody reads the answer of
    const clientGone = new AbortController();
    const onClose = () => {
      if (!response.writableFinished) clientGone.abort();
    };
    response.once('close', onClose);

    const handleRequest = async () => {
      if (limitRequestBody > 0 && Number(request.headers['content-length']) > limitRequestBody) {
        throw new RequestBodyTooLargeError(`The body is larger than ${limitRequestBody} bytes.`);
      }

      const lease = await pool.acquire(lambdaPath, {}, limit > 0 ? limit : NO_LIMIT, clientGone.signal);

      try {
        await lease.ready();
        if (clientGone.signal.aborted) return;

        const event = createWorkerRequestEvent({ request, pathParameters, deadline: Date.now() + timeout });
        const outcome = await invokeLambda({ lease, request, requestId, event, timeout, limitRequestBody });

        answerOutcome({ outcome, request, response, lease });
      } finally {
        lease.release();
      }
    };

    handleRequest()
      .catch((error) => answerFailure({ error, request, response, logger }))
      .finally(() => response.off('close', onClose));
  };

  return Object.assign((request: IncomingMessage, response: ServerResponse) => handle(request, response), {
    handle,
    close: () => {
      // the lambdas stop once they answered, the timer that ends them for good does not keep the process alive
      pool.dispose(DEFAULT_TIMEOUT).then(() => stats.remove(statsSource));
    },
  });
}

export default createHttpMiddleware;
