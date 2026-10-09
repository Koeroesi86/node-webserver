import type { RequestHandler } from 'express';
import getHostname from './get-hostname';
import getHostPattern from './get-host-pattern';
import type { VirtualHost } from '../types/virtual-host';

interface Route {
  /** the place of the host in the configuration, which decides the precedence */
  order: number;
  handler: RequestHandler;
}

/**
 * one handler for many virtual hosts. A host without wildcards is found in a map, so the cost of a request does not grow with the number of hosts,
 * and only the hosts with wildcards are tested one by one. The hosts that match are run in the order of the configuration,
 * and a handler that calls `next` passes the request on to the next one, as it did when every host was a `vhost` middleware of its own.
 */
function virtualHostRouter(hosts: VirtualHost[]): RequestHandler {
  const exactRoutes = new Map<string, Route[]>();
  const patternRoutes: (Route & { pattern: RegExp })[] = [];

  hosts.forEach(({ hostname, handler }, order) => {
    if (hostname.includes('*')) {
      patternRoutes.push({ order, handler, pattern: getHostPattern(hostname) });
      return;
    }

    const key = hostname.toLowerCase();
    exactRoutes.set(key, [...(exactRoutes.get(key) ?? []), { order, handler }]);
  });

  return (request, response, next) => {
    const hostname = getHostname(request.headers.host);

    if (!hostname) {
      next();
      return;
    }

    const exactMatches = exactRoutes.get(hostname) ?? [];
    const routes =
      patternRoutes.length === 0
        ? exactMatches
        : [...exactMatches, ...patternRoutes.filter(({ pattern }) => pattern.test(hostname))].sort((first, second) => first.order - second.order);

    const runFrom =
      (index: number) =>
      (error?: unknown): void => {
        // `next('route')` only skips the rest of a route, between middlewares it goes on like `next()`
        if (error && error !== 'route') {
          next(error);
          return;
        }
        if (index === routes.length) {
          next();
          return;
        }
        routes[index].handler(request, response, runFrom(index + 1));
      };

    runFrom(0)();
  };
}

export default virtualHostRouter;
