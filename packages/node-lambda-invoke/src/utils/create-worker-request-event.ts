import type { IncomingMessage } from 'http';
import type { RequestEvent } from '@koeroesi86/node-worker-pool';
import parseQueryString from './parse-query-string';

interface WorkerRequestEventParams {
  request: IncomingMessage;
  pathParameters?: Record<string, string>;
  /** when the invocation runs out of time, in milliseconds since the epoch */
  deadline: number;
}

/** the parameters of a query as the worker protocol has them: a repeated one is an array, the worker takes the last value of it for API Gateway, which keeps them all in the multi value parameters */
const toQueryParameters = (query: string) =>
  Object.fromEntries(Object.entries(parseQueryString(query).multi ?? {}).map(([key, values]) => [key, values.length === 1 ? values[0] : values]));

const hasBody = ({ headers }: IncomingMessage) =>
  (headers['content-length'] !== undefined && headers['content-length'] !== '0') || headers['transfer-encoding'] !== undefined;

/** what the worker of a lambda is told about a request: more than a worker of a file is, as the event of API Gateway has the headers as they were written and every value of them */
const createWorkerRequestEvent = ({ request, pathParameters, deadline }: WorkerRequestEventParams): RequestEvent => {
  const url = request.url ?? '/';
  const queryStart = url.indexOf('?');

  return {
    httpMethod: request.method?.toUpperCase() ?? '',
    protocol: 'HTTP',
    path: (queryStart === -1 ? url : url.slice(0, queryStart)) || '/',
    pathFragments: [],
    queryStringParameters: toQueryParameters(queryStart === -1 ? '' : url.slice(queryStart + 1)),
    headers: Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : (value ?? '')])),
    rawHeaders: request.rawHeaders,
    httpVersion: request.httpVersion,
    remoteAddress: request.socket.remoteAddress ?? '',
    rootPath: '',
    deadline,
    ...(pathParameters && { pathParameters }),
    ...(hasBody(request) && { hasBody: true }),
  };
};

export default createWorkerRequestEvent;
