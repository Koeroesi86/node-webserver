import { RoutePathLimit, RoutePatternFlags } from '../constants';
import type { RouteSelector } from '../types';

export interface RouteMatcherResult<T> {
  /** what the route that matched was made into by `resolveTarget` */
  target: T;
  /** the named groups of the pattern that matched */
  pathParameters?: { [key: string]: string };
}

const compilePattern = (pattern: string, flags: string, position: number) => {
  const unknownFlag = [...flags].find((flag) => !RoutePatternFlags.includes(flag));
  if (unknownFlag !== undefined) {
    throw new Error(`routes[${position}] has the flag ${unknownFlag}, only ${RoutePatternFlags.join(', ')} can be used.`);
  }

  try {
    // compiled on its own first, so that a pattern which closes the group around it (`a)|(b`) cannot undo the anchors
    const standalone = new RegExp(pattern, flags);
    return new RegExp(`^(?:${standalone.source})$`, flags);
  } catch (error) {
    throw new Error(`The pattern of routes[${position}] is not valid: ${error instanceof Error ? error.message : error}`);
  }
};

// a group that took no part in the match is undefined, which the target would not get through a message anyway
const parametersOf = (groups: { [key: string]: string }) => Object.fromEntries(Object.entries(groups).filter(([, value]) => value !== undefined));

/**
 * The routes compiled into a function that finds the target of a path. Paths go into a map, patterns are tried in their order,
 * and the first route in the configuration that matches wins, whichever kind it is. Throws when a route is not valid.
 * `resolveTarget` runs for every route, in order and before the route itself is checked, and may throw as well: it is where a route gets what it leads to.
 */
const createRouteMatcher = <Route extends RouteSelector, T>(routes: Route[], resolveTarget: (route: Route, position: number) => T) => {
  const paths = new Map<string, { position: number; target: T }>();
  const patterns: Array<{ position: number; matcher: RegExp; target: T }> = [];

  routes.forEach((route, position) => {
    const target = resolveTarget(route, position);

    if ('path' in route && 'pattern' in route) {
      throw new Error(`routes[${position}] has both a path and a pattern.`);
    }

    if ('path' in route) {
      if (typeof route.path !== 'string' || !route.path.startsWith('/') || route.path.length > RoutePathLimit) {
        throw new Error(`The path of routes[${position}] has to start with / and be at most ${RoutePathLimit} characters long.`);
      }
      // a later route for the same path is never reached
      if (!paths.has(route.path)) paths.set(route.path, { position, target });
      return;
    }

    if (typeof route.pattern !== 'string') {
      throw new Error(`routes[${position}] needs a path or a pattern.`);
    }
    patterns.push({ position, matcher: compilePattern(route.pattern, route.flags ?? '', position), target });
  });

  return (pathname: string): RouteMatcherResult<T> | undefined => {
    if (pathname.length > RoutePathLimit) return undefined;

    const exact = paths.get(pathname);
    // only the patterns listed before the path can come first
    const before = exact?.position ?? Infinity;
    for (const { position, matcher, target } of patterns) {
      if (position > before) break;
      const found = matcher.exec(pathname);
      if (found) return { target, ...(found.groups && { pathParameters: parametersOf(found.groups) }) };
    }

    return exact && { target: exact.target };
  };
};

export default createRouteMatcher;
