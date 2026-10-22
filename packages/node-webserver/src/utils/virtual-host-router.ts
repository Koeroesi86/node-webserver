import type { RequestHandler } from 'express';
import getHostname from './get-hostname';
import getHostPattern from './get-host-pattern';
import type { VirtualHost } from '../types/virtual-host';

interface Route {
  /** the place of the host in the configuration, which decides the precedence */
  order: number;
  handler: RequestHandler;
}

interface PatternRoute extends Route {
  pattern: RegExp;
}

interface RouteGroups {
  exact: Map<string, Route[]>;
  patterns: PatternRoute[];
}

function buildRouteGroups(hosts: VirtualHost[]): RouteGroups {
  const exact = new Map<string, Route[]>();
  const patterns: PatternRoute[] = [];

  hosts.forEach(({ hostname, handler }, order) => {
    if (hostname.includes('*')) {
      patterns.push({ order, handler, pattern: getHostPattern(hostname) });
      return;
    }

    const key = hostname.toLowerCase();
    exact.set(key, [...(exact.get(key) ?? []), { order, handler }]);
  });

  return { exact, patterns };
}

function selectRoutes(hostname: string, { exact, patterns }: RouteGroups): Route[] {
  const exactMatches = exact.get(hostname) ?? [];

  if (patterns.length === 0) {
    return exactMatches;
  }

  return [...exactMatches, ...patterns.filter(({ pattern }) => pattern.test(hostname))].sort((first, second) => first.order - second.order);
}

function runRoutes(
  routes: Route[],
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
  next: Parameters<RequestHandler>[2],
  index = 0
): void {
  if (index === routes.length) {
    next();
    return;
  }

  routes[index].handler(request, response, (error?: unknown) => {
    // `next('route')` only skips the rest of a route, between middlewares it goes on like `next()`
    if (error && error !== 'route') {
      next(error);
      return;
    }

    runRoutes(routes, request, response, next, index + 1);
  });
}

/**
 * one handler for many virtual hosts. A host without wildcards is found in a map, so the cost of a request does not grow with the number of hosts,
 * and only the hosts with wildcards are tested one by one. The hosts that match are run in the order of the configuration,
 * and a handler that calls `next` passes the request on to the next one, as it did when every host was a `vhost` middleware of its own.
 * The `fallback` is the last one: it gets the requests that no host answered, and those without a usable `Host` header.
 * Without a fallback, a request that no host takes is answered with `421`, while one that a host passed on goes on with `next`.
 */
function virtualHostRouter(hosts: VirtualHost[], fallback?: RequestHandler): RequestHandler {
  const routes = buildRouteGroups(hosts);
  const last: Route[] = fallback ? [{ order: Infinity, handler: fallback }] : [];

  return (request, response, next) => {
    const hostname = getHostname(request.headers.host);
    const matches = hostname ? selectRoutes(hostname, routes) : [];

    if (matches.length === 0 && last.length === 0) {
      response.status(421).type('text/plain').send('Misdirected Request');
      return;
    }

    runRoutes([...matches, ...last], request, response, next);
  };
}

export default virtualHostRouter;
