import { WorkerPool } from '@koeroesi86/node-worker/pool';
import path from 'path';
import { DefaultOptions } from '../constants';
import {
  createLeaseAcquirer,
  createPathLatency,
  createProbe,
  createRequestHandler,
  createRouteTable,
  createSlotCounter,
  createStaticWorkerOptions,
  createTargetResolver,
  createWatchedProbe,
  registerMetricsSource,
  warmPaths,
} from '../utils';
import { MiddlewareOptions, WorkerMiddleware } from '../types';

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
  // validated before anything is started
  const staticWorkerOptions = createStaticWorkerOptions(config.static);
  if (config.warmStaticWorker) {
    workerPool.warm(config.staticWorker, staticWorkerOptions);
  }
  const getLimitPerPath = (indexPath: string) => (typeof config.limitPerPath === 'function' ? config.limitPerPath(indexPath) : config.limitPerPath);
  const webSocketSlots = createSlotCounter(config.limitWebSocketConnections);
  const probe = createWatchedProbe(createProbe(), { maxDirectories: config.limitWatchedDirectories, maxTotalEntries: config.limitWatchedEntries });
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

  const handler = createRequestHandler({
    options: config,
    rootPath,
    staticWorker: config.staticWorker,
    resolveTarget,
    acquireLease,
    pathLatency,
    webSocketSlots,
  });

  return Object.assign(handler, {
    close: (timeout?: number) => {
      unregisterMetrics();
      probe.close();
      return workerPool.dispose(timeout);
    },
  });
};

export default workerMiddleware;
