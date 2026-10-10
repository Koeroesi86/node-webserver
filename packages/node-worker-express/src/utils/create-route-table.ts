import fs from 'fs';
import path from 'path';
import { RoutePathLimit, RoutePatternFlags } from '../constants';
import type { WorkerRoute } from '../types';

export interface RouteMatch {
  /** the absolute path of the worker file */
  worker: string;
  /** the named groups of the pattern that matched */
  pathParameters?: { [key: string]: string };
}

/** checked once here, so that a mistake in the configuration shows when the server starts and not with the first request for it */
const resolveWorker = (rootPath: string, worker: string, position: number) => {
  if (typeof worker !== 'string' || worker === '') {
    throw new Error(`routes[${position}] has no worker.`);
  }
  const workerPath = path.resolve(rootPath, worker);
  if (!fs.statSync(workerPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`The worker of routes[${position}] is not a file: ${workerPath}`);
  }

  return workerPath;
};

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

// a group that took no part in the match is undefined, which the worker would not get through the message anyway
const parametersOf = (groups: { [key: string]: string }) => Object.fromEntries(Object.entries(groups).filter(([, value]) => value !== undefined));

/**
 * The routes compiled into a function that finds the worker for a path. Paths go into a map, patterns are tried in their order,
 * and the first route in the configuration that matches wins, whichever kind it is. Throws when a route is not valid.
 */
const createRouteTable = (rootPath: string, routes: WorkerRoute[]) => {
  const paths = new Map<string, { position: number; worker: string }>();
  const patterns: Array<{ position: number; matcher: RegExp; worker: string }> = [];

  routes.forEach((route, position) => {
    const worker = resolveWorker(rootPath, route.worker, position);

    if ('path' in route && 'pattern' in route) {
      throw new Error(`routes[${position}] has both a path and a pattern.`);
    }

    if ('path' in route) {
      if (typeof route.path !== 'string' || !route.path.startsWith('/') || route.path.length > RoutePathLimit) {
        throw new Error(`The path of routes[${position}] has to start with / and be at most ${RoutePathLimit} characters long.`);
      }
      // a later route for the same path is never reached
      if (!paths.has(route.path)) paths.set(route.path, { position, worker });
      return;
    }

    if (typeof route.pattern !== 'string') {
      throw new Error(`routes[${position}] needs a path or a pattern.`);
    }
    patterns.push({ position, matcher: compilePattern(route.pattern, route.flags ?? '', position), worker });
  });

  return (pathname: string): RouteMatch | undefined => {
    if (pathname.length > RoutePathLimit) return undefined;

    const exact = paths.get(pathname);
    // only the patterns listed before the path can come first
    const before = exact?.position ?? Infinity;
    for (const { position, matcher, worker } of patterns) {
      if (position > before) break;
      const found = matcher.exec(pathname);
      if (found) return { worker, ...(found.groups && { pathParameters: parametersOf(found.groups) }) };
    }

    return exact && { worker: exact.worker };
  };
};

export default createRouteTable;
