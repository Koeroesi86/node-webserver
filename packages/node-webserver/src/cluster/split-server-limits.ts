import os from 'os';
import type { FrontShare, ServerConfig, WorkerOptions } from '../types';
import shareLimit from './share-limit';

const splitWorkerOptions = (options: WorkerOptions, front: FrontShare): WorkerOptions => {
  // the default of the middleware, which is a limit of the whole server like one that is set
  const { limit, limitPerPath = os.availableParallelism() } = options;

  return {
    ...options,
    ...(limit !== undefined && { limit: shareLimit(limit, front) }),
    // a function says what a path gets as a whole, every front gets at least one worker of it
    limitPerPath: typeof limitPerPath === 'function' ? (path: string) => Math.max(1, shareLimit(limitPerPath(path), front)) : shareLimit(limitPerPath, front),
  };
};

/** The definition of a server with the share of a front of its limits, the defaults of the ones that are not set included. With one front it is the definition as it is. */
const splitServerLimits = (instance: ServerConfig, front: FrontShare): ServerConfig => {
  if (front.count === 1) return instance;
  if (instance.type === 'worker' && instance.options) return { ...instance, options: splitWorkerOptions(instance.options, front) };
  if (instance.type !== 'lambda' || !instance.lambdaOptions) return instance;

  const { limit = os.availableParallelism(), routes } = instance.lambdaOptions;

  return {
    ...instance,
    lambdaOptions: {
      ...instance.lambdaOptions,
      limit: shareLimit(limit, front),
      // a route without a limit takes the one of the server, which is shared already
      ...(routes && { routes: routes.map((route) => (route.limit === undefined ? route : { ...route, limit: shareLimit(route.limit, front) })) }),
    },
  };
};

export default splitServerLimits;
