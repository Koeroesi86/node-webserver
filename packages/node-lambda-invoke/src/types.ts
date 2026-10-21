import type { RequestEvent } from './classes';

export type Logger = (...args: unknown[]) => void;

export interface HttpMiddlewareOptions {
  lambdaPath: string;
  handlerKey?: string;
  logger?: Logger;
  /**
   * how many lambdas this middleware may run, they are shared by all of its requests: a lambda answers one request at a time. Defaults to the number of CPU cores, 0 means no limit.
   * Every middleware has a limit of its own.
   */
  limit?: number;
  /** how long a request waits for a lambda when the limit is reached before it is answered with 503, in milliseconds. Defaults to 10000. */
  acquireTimeout?: number;
  /** how long a lambda may take to load and start, in milliseconds, before it is stopped and the request is answered with 500. Defaults to 10000. */
  startTimeout?: number;
  /** how long the handler may take to answer, in milliseconds, before the lambda is stopped and the request is answered with 504. Defaults to 900000 (15 minutes). */
  timeout?: number;
  /** the largest body of a request in bytes, larger ones are answered with 413, 0 for no limit. Defaults to 6291456 (6 MiB), the payload limit of AWS. */
  limitRequestBody?: number;
  /**
   * Whether a lambda can only write to its own folder (its `/tmp`, see `os.tmpdir()`) and not to the rest of the file system, as on AWS. Defaults to true.
   * Needs a node that has the permission model.
   */
  restrictFileSystem?: boolean;
  /** variables added to the environment of the lambdas, which only get a few of the server (`PATH`, `HOME`, `TZ`, ...) */
  env?: Record<string, string>;
  /** the registry (see `createLambdaStats`) where the middleware lists its lambdas for the stats. Defaults to the one of `getLambdaStats`. */
  stats?: LambdaStats;
}

/** a lambda pool as the stats see it */
export interface LambdaStatsSource {
  readonly lambdaPath: string;
  readonly started: number;
  readonly starting: number;
  readonly count: number;
  readonly busy: number;
  readonly waiting: number;
  readonly abandoned: number;
}

/** the lambda pools of a server, for its stats. Made by `createLambdaStats`. */
export interface LambdaStats {
  add: (pool: LambdaStatsSource) => void;
  /** a pool that is closed and has no lambda left stops counting */
  remove: (pool: LambdaStatsSource) => void;
  getStats: () => {
    lambdas: number;
    starting: number;
    busy: number;
    waiting: number;
    abandoned: number;
    files: Record<string, { lambdas: number; busy: number }>;
  };
}

/** what API Gateway tells a lambda about the request */
export interface RequestContext {
  accountId: string;
  apiId: string;
  stage: string;
  /** the id of the invocation, which is also the `awsRequestId` of the context */
  requestId: string;
  resourcePath: string;
  httpMethod: string;
  path: string;
  protocol: string;
  requestTime: string;
  requestTimeEpoch: number;
  domainName: string;
  identity: { sourceIp: string; userAgent: string };
}

/** the callback of a handler: an error, or the response */
export type LambdaCallback = (error?: unknown, response?: unknown) => void;

/** the context a handler is called with, as on AWS */
export interface LambdaContext {
  callbackWaitsForEmptyEventLoop: boolean;
  functionName: string;
  functionVersion: string;
  invokedFunctionArn: string;
  memoryLimitInMB: string;
  awsRequestId: string;
  logGroupName: string;
  logStreamName: string;
  getRemainingTimeInMillis: () => number;
  /** the callbacks of the context of the old runtimes */
  done: LambdaCallback;
  succeed: (response?: unknown) => void;
  fail: (error?: unknown) => void;
}

/** a handler of a lambda: it answers with the callback, or with the promise it returns, whichever settles first */
export type LambdaHandler = (event: RequestEvent, context: LambdaContext, callback: LambdaCallback) => unknown;
