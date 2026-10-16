import { randomBytes } from 'crypto';
import path from 'path';
import url from 'url';
import { DefaultOptions, Protocols, StaticOptionsEnv } from '../constants';
import WorkerPool from '../utils/workerPool';
import isWebSocket from '../utils/isWebSocket';
import createSlotCounter from '../utils/create-slot-counter';
import hasBody from '../utils/hasBody';
import type { RequestHandler } from 'express';
import { MiddlewareOptions, WorkerMiddleware } from '../types';
import createProbe from '../utils/createProbe';
import normalizeStaticOptions from '../utils/normalize-static-options';
import createRouteTable from '../utils/create-route-table';
import createPathLatency from '../utils/create-path-latency';
import { registerMetricsSource, trackRequest } from '../utils/metrics';
import buildRequestEvent from '../utils/build-request-event';
import prepareRequestBody from '../utils/prepare-request-body';
import serveRequest from '../utils/serve-request';
import writeTextResponse from '../utils/write-text-response';
import createTargetResolver from '../utils/create-target-resolver';
import createLeaseAcquirer from '../utils/create-lease-acquirer';
import handleRequestError from '../utils/handle-request-error';
import runInSlot from '../utils/run-in-slot';
import warmPaths from '../utils/warm-paths';

// ids only have to differ inside this process, which is cheaper to make than a random uuid
const requestIdPrefix = randomBytes(4).toString('hex');
let requestCount = 0;
const noop = () => {};
const createRequestId = () => `${requestIdPrefix}-${(requestCount += 1).toString(36)}`;

const workerMiddleware = (options: MiddlewareOptions): WorkerMiddleware => {
  const config = {
    ...DefaultOptions,
    ...options,
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
  const probe = createProbe();
  const pathLatency = createPathLatency();
  const unregisterMetrics = registerMetricsSource(`workers:${config.name ?? rootPath}`, () => ({ ...workerPool.getStats(), latencyMs: pathLatency.read() }));
  void warmPaths({
    paths: config.warmPaths,
    rootPath,
    index: config.index,
    probe,
    countFor: (indexPath) => Math.min(config.warmWorkersPerPath, Math.max(getLimitPerPath(indexPath), 1)),
    keepWarm: (indexPath, count) => workerPool.keepWarm(indexPath, workerOptions, count),
  });
  const resolveTarget = createTargetResolver({
    rootPath,
    index: config.index,
    fallthrough: config.fallthrough,
    probe,
    findRoute,
    onForbiddenPath: config.onForbiddenPath,
    answersMissingPaths: config.staticWorker === DefaultOptions.staticWorker,
  });
  const acquireLease = createLeaseAcquirer({
    acquire: workerPool.acquire,
    staticWorker: config.staticWorker,
    workerOptions,
    staticWorkerOptions,
    getLimitPerPath,
  });

  const handler: RequestHandler = async (request, response, next) => {
    const { query, pathname } = url.parse(request.url, true);
    const tracked = trackRequest(response);

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

      // a websocket slot is taken before the worker, so connections above the limit do not queue for one
      const served = await runInSlot(
        () => (protocol === Protocols.websocket ? webSocketSlots.take(indexPath) : noop),
        () => {
          // by worker file like the pool, so every static file counts in the static worker's (a missing path answered above only in the totals)
          tracked.path = pathLatency.get(isWorker ? indexPath : config.staticWorker);
          return acquireLease(response, indexPath, isWorker);
        },
        (lease, releaseSlot) =>
          serveRequest({ request, response, lease, requestId: createRequestId(), event, inlineBody, streamsBody, releaseSlot, options: config })
      );
      if (!served) writeTextResponse(response, 503, 'Too many connections.', { 'Retry-After': 1 });
    } catch (e) {
      handleRequestError(e, response, next);
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
