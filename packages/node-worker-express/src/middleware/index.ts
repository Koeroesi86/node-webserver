import { randomBytes } from 'crypto';
import path from 'path';
import url from 'url';
import { DefaultOptions, ForbiddenPaths, Protocols, StaticOptionsEnv } from '../constants';
import WorkerPool from '../utils/workerPool';
import WorkerUnavailableError from '../utils/workerUnavailableError';
import WorkerAbandonedError from '../utils/workerAbandonedError';
import isWebSocket from '../utils/isWebSocket';
import createSlotCounter from '../utils/create-slot-counter';
import hasBody from '../utils/hasBody';
import type { Request, RequestHandler, Response } from 'express';
import { MiddlewareOptions, WorkerMiddleware } from '../types';
import resolvePath from '../utils/resolvePath';
import createProbe from '../utils/createProbe';
import notFoundResponse from '../utils/not-found-response';
import normalizeStaticOptions from '../utils/normalize-static-options';
import createRouteTable from '../utils/create-route-table';
import TtlCache from '../utils/ttlCache';
import createPathLatency from '../utils/create-path-latency';
import { registerMetricsSource, trackRequest } from '../utils/metrics';
import buildRequestEvent from '../utils/build-request-event';
import prepareRequestBody from '../utils/prepare-request-body';
import serveRequest from '../utils/serve-request';
import writeTextResponse from '../utils/write-text-response';

/** how long the way to a path is remembered, and how many paths are, so that a client asking for endless different ones cannot grow the cache */
const routeCacheTtl = 5000;
const routeCacheSize = 10000;

// ids only have to differ inside this process, which is cheaper to make than a random uuid
const requestIdPrefix = randomBytes(4).toString('hex');
let requestCount = 0;
const noop = () => {};
const createRequestId = () => `${requestIdPrefix}-${(requestCount += 1).toString(36)}`;

const workerMiddleware = (options: MiddlewareOptions): WorkerMiddleware => {
  const config = {
    ...DefaultOptions,
    ...(options && options),
  };
  if (!config.root) {
    throw new Error('No root path defined in configuration!');
  }
  const rootPath = path.resolve(config.root);
  // before anything is started, so that a route that is not valid leaves no worker pool behind
  const findRoute = createRouteTable(rootPath, config.routes ?? []);
  const workerPool = new WorkerPool({
    overallLimit: config.limit,
    onExit: config.onExit,
    acquireTimeout: config.limitRequestTimeout,
    maxQueue: config.limitQueue,
    onStdout: config.onStdout,
    onStderr: config.onStderr,
    idleTimeout: config.limitWorkerIdleTimeout,
    budget: config.workerBudget,
  });
  // a function, as copying the environment is costly and only needed when a worker is started, not for every request
  const workerOptions = () => ({
    env: { ...process.env, ...config.env },
    cwd: config.cwd,
  });
  // validated before anything is started, the worker reads them from its environment
  const staticOptions = config.static && JSON.stringify(normalizeStaticOptions(config.static));
  const staticWorkerOptions = { cwd: process.cwd(), ...(staticOptions && { env: { ...process.env, [StaticOptionsEnv]: staticOptions } }) };
  if (config.warmStaticWorker) {
    workerPool.warm(config.staticWorker, staticWorkerOptions);
  }
  const getLimitPerPath = (indexPath: string) => (typeof config.limitPerPath === 'function' ? config.limitPerPath(indexPath) : config.limitPerPath);
  const webSocketSlots = createSlotCounter(config.limitWebSocketConnections);
  const routeCache = new TtlCache<{ indexPath: string; isWorker: boolean }>(routeCacheTtl, routeCacheSize);
  const probe = createProbe();
  // another static worker may answer a missing path in its own way, for example with the page of a single page app
  const answersMissingPaths = config.staticWorker === DefaultOptions.staticWorker;
  const pathLatency = createPathLatency();
  const unregisterMetrics = registerMetricsSource(`workers:${config.name ?? rootPath}`, () => ({ ...workerPool.getStats(), latencyMs: pathLatency.read() }));
  // the worker files are found the way a request finds them, a path that is served by the static worker has nothing to keep warm
  config.warmPaths.forEach((warmPath) =>
    resolvePath(rootPath, warmPath.split('/').filter(Boolean), config.index, probe)
      .then(({ indexPath, isWorker }) => {
        if (isWorker) workerPool.keepWarm(indexPath, workerOptions, Math.min(config.warmWorkersPerPath, Math.max(getLimitPerPath(indexPath), 1)));
      })
      // warming is an optimization, a path that cannot be looked up is started by its first request
      .catch(() => undefined)
  );

  const findInRoot = async (pathname: string, pathFragments: string[]) => {
    // a path that was resolved lately is trusted until its entry expires, without asking the file system again
    const cached = routeCache.get(pathname);
    if (cached) return { ...cached, targetExists: true };

    const resolved = await resolvePath(rootPath, pathFragments, config.index, probe);
    // a path that is not there is not remembered as a route: the probe remembers the missing file for a shorter time, so that a file that is added is found soon
    if (resolved.isWorker || resolved.targetExists) routeCache.set(pathname, { indexPath: resolved.indexPath, isWorker: resolved.isWorker });

    return resolved;
  };

  /** where the request goes, undefined when it was answered here */
  const resolveTarget = async (request: Request, response: Response, pathname: string, pathFragments: string[]) => {
    if (pathFragments.some((fragment) => ForbiddenPaths.includes(fragment))) {
      config.onForbiddenPath(request, response);
      return undefined;
    }

    const route = findRoute(pathname);
    if (route === undefined && !config.fallthrough) {
      writeTextResponse(response, 404, 'Not found.');
      return undefined;
    }

    const target = route ? { indexPath: route.worker, isWorker: true, targetExists: true } : await findInRoot(pathname, pathFragments);

    // A path that is not there and that no worker answers is the 404 of the static worker, which is known here without the round trip to it.
    if (!target.isWorker && !target.targetExists && answersMissingPaths) {
      const { statusCode, headers, body } = notFoundResponse();
      response.writeHead(statusCode, { ...headers, 'Content-Length': Buffer.byteLength(body) });
      response.end(body);
      return undefined;
    }

    return { ...target, pathParameters: route?.pathParameters };
  };

  const acquireLease = async (response: Response, indexPath: string, isWorker: boolean) => {
    const limitPerPath = getLimitPerPath(indexPath);
    // a request that waits for a worker leaves the line when its client goes away
    const abandoned = new AbortController();
    const abandon = () => abandoned.abort();
    response.once('close', abandon);

    return (
      isWorker
        ? workerPool.acquire(indexPath, workerOptions, limitPerPath, abandoned.signal)
        : workerPool.acquire(config.staticWorker, staticWorkerOptions, limitPerPath, abandoned.signal)
    ).finally(() => response.off('close', abandon));
  };

  const handler: RequestHandler = async (request, response, next) => {
    const { query, pathname } = url.parse(request.url, true);
    const tracked = trackRequest(response);
    /** frees the slot of a websocket connection, also when the request fails before it has a worker */
    let releaseSlot = noop;

    try {
      const pathFragments = pathname.split(/\//gi).filter(Boolean);
      const target = await resolveTarget(request, response, pathname, pathFragments);
      if (!target) return;

      const { indexPath, isWorker, pathParameters } = target;
      const protocol = isWebSocket(request) ? Protocols.websocket : Protocols.http;
      const { inlineBody, streamsBody } = await prepareRequestBody(
        request,
        protocol === Protocols.http && hasBody(request) && isWorker,
        config.inlineRequestBody
      );

      if (inlineBody !== undefined && config.limitRequestBody && inlineBody.length > config.limitRequestBody) {
        writeTextResponse(response, 413, 'Request body too large.');
        return;
      }

      const event = buildRequestEvent({ request, protocol, pathname, pathFragments, query, rootPath, pathParameters, streamsBody });

      // the slot of a websocket connection is taken before the worker is, so that connections above the limit do not queue for one
      const slot = protocol === Protocols.websocket ? webSocketSlots.take(indexPath) : noop;
      if (!slot) {
        writeTextResponse(response, 503, 'Too many connections.', { 'Retry-After': 1 });
        return;
      }
      releaseSlot = slot;

      // by the worker file, like the paths of the pool, so every static file, found or not, counts in the one of the static worker (a missing path answered above only in the totals)
      tracked.path = pathLatency.get(isWorker ? indexPath : config.staticWorker);

      const lease = await acquireLease(response, indexPath, isWorker);

      serveRequest({ request, response, lease, requestId: createRequestId(), event, inlineBody, streamsBody, releaseSlot, options: config });
    } catch (e) {
      releaseSlot();
      if (e instanceof WorkerAbandonedError) return;
      if (e instanceof WorkerUnavailableError && !response.headersSent) {
        // the details name a file of the server, the client only needs to know when to come back
        writeTextResponse(response, 503, 'Service unavailable.', { 'Retry-After': Math.max(1, Math.ceil(e.retryAfterMs / 1000)) });
        return;
      }
      next(e);
    }
  };

  return Object.assign(handler, {
    close: (timeout?: number) => {
      unregisterMetrics();
      return workerPool.dispose(timeout);
    },
  });
};

export default workerMiddleware;
