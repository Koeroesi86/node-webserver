import fs from 'fs';
import path from 'path';
import createRouteMatcher from './create-route-matcher';
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

/** The routes of a worker server compiled into a function that finds the worker for a path, see `createRouteMatcher` for the rules. Throws when a route is not valid. */
const createRouteTable = (rootPath: string, routes: WorkerRoute[]) => {
  const match = createRouteMatcher(routes, ({ worker }, position) => resolveWorker(rootPath, worker, position));

  return (pathname: string): RouteMatch | undefined => {
    const found = match(pathname);

    return found && { worker: found.target, ...(found.pathParameters && { pathParameters: found.pathParameters }) };
  };
};

export default createRouteTable;
