import type { RouteSelector } from '@koeroesi86/node-worker-express';

/**
 * A route of a lambda server: a request whose path matches it is invoked on `lambda`, with the limit and the handler of the route.
 * The lambda and the handler are always the ones named here, never made from the request.
 */
export type LambdaRoute = RouteSelector & {
  /** the file of the lambda */
  lambda: string;
  /** the export of the file, `handler` by default */
  handler?: string;
  /** how many lambdas this route may run, `limit` of the server by default. The lambdas of a route are never used by, nor stopped for, another route. */
  limit?: number;
};

export interface LambdaOptions {
  lambda?: string;
  handler?: string;
  /**
   * Routes to several lambdas, or several handlers of one file, from one server. The first one that matches the path decides, a path or a pattern alike. Named groups of a pattern become `pathParameters` of the event.
   * A path that none matches goes to `lambda` and `handler` when they are set, as the route for every other path, otherwise it is answered with 404 without a lambda being started.
   * The matching runs on the front process for every request, so patterns are trusted configuration: avoid ones that backtrack, like nested repetitions.
   */
  routes?: LambdaRoute[];
  /** how many lambdas this server may run. Defaults to the number of CPU cores, 0 means no limit. Every lambda server has a limit of its own. */
  limit?: number;
  /** how long a request waits for a lambda when the limit is reached before it is answered with 503, in milliseconds. Defaults to 10000. */
  acquireTimeout?: number;
  /** how long a lambda may take to load and start before it is stopped and the request is answered with 500, in milliseconds. Defaults to 10000. */
  startTimeout?: number;
  /** how long the handler may take to answer before the lambda is stopped and the request is answered with 504, in milliseconds. Defaults to 900000 (15 minutes). */
  timeout?: number;
  /** the largest body of a request in bytes, larger ones are answered with 413, 0 for no limit. Defaults to 6291456 (6 MiB), the payload limit of AWS. */
  limitRequestBody?: number;
  /** whether a lambda can only write to its own folders (`os.tmpdir()` is its `/tmp`) and not to the rest of the file system, as on AWS. Defaults to true. */
  restrictFileSystem?: boolean;
  /** variables of the environment of the lambdas, which get only a few of the server (`PATH`, `HOME`, `TZ`, ...) */
  env?: Record<string, string>;
}
