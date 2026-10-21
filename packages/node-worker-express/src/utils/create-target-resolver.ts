import type { Request, Response } from 'express';
import { ForbiddenPaths } from '../constants';
import type { Probe } from './create-probe';
import notFoundResponse from './not-found-response';
import resolvePath from './resolve-path';
import TtlCache from './ttl-cache';
import writeTextResponse from './write-text-response';

/** how long the way to a path is remembered, and how many paths are, so that a client asking for endless different ones cannot grow the cache */
const routeCacheTtl = 5000;
const routeCacheSize = 10000;

interface TargetResolverParams {
  rootPath: string;
  index: string[];
  fallthrough: boolean;
  probe: Probe;
  findRoute: (pathname: string) => { worker: string; pathParameters?: Record<string, string> } | undefined;
  onForbiddenPath: (request: Request, response: Response) => void;
  /** another static worker may answer a missing path in its own way, for example with the page of a single page app */
  answersMissingPaths: boolean;
}

/** Finds where a request goes. Gives undefined when the request was answered here, a forbidden or missing path is not worth a worker. */
const createTargetResolver = ({ rootPath, index, fallthrough, probe, findRoute, onForbiddenPath, answersMissingPaths }: TargetResolverParams) => {
  const routeCache = new TtlCache<{ indexPath: string; isWorker: boolean }>(routeCacheTtl, routeCacheSize);

  const findInRoot = async (pathname: string, pathFragments: string[]) => {
    // a path that was resolved lately is trusted until its entry expires, without asking the file system again
    const cached = routeCache.get(pathname);
    if (cached) return { ...cached, targetExists: true };

    const resolved = await resolvePath(rootPath, pathFragments, index, probe);
    // a path that is not there is not remembered as a route: the probe remembers the missing file for a shorter time, so that a file that is added is found soon
    if (resolved.isWorker || resolved.targetExists) routeCache.set(pathname, { indexPath: resolved.indexPath, isWorker: resolved.isWorker });

    return resolved;
  };

  return async (request: Request, response: Response, pathname: string, pathFragments: string[]) => {
    if (pathFragments.some((fragment) => ForbiddenPaths.includes(fragment))) {
      onForbiddenPath(request, response);
      return undefined;
    }

    const route = findRoute(pathname);
    if (route === undefined && !fallthrough) {
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
};

export default createTargetResolver;
