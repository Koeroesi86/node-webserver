import type { WorkerRequestEvent } from '@koeroesi86/node-worker/pool';
import { RequestEvent } from '../classes';
import parseRawHeaders from './parse-raw-headers';

const decoder = new TextDecoder('utf-8', { fatal: true });

/** the text of the body when it is valid UTF-8, otherwise the bytes in base64 */
const encodeBody = (body: Buffer | undefined) => {
  // eslint-disable-next-line no-restricted-syntax -- an event without a body has a null one on aws
  if (body === undefined) return { body: null, isBase64Encoded: false };

  try {
    return { body: decoder.decode(body), isBase64Encoded: false };
  } catch {
    return { body: body.toString('base64'), isBase64Encoded: true };
  }
};

const toValues = (value: string | string[]) => (Array.isArray(value) ? value : [value]);

/** the parameters of the query the way API Gateway passes them: the last value of a repeated one, and `null` when there are none */
const toQueryParameters = (query: WorkerRequestEvent['queryStringParameters']) => {
  const entries = Object.entries(query);

  // eslint-disable-next-line no-restricted-syntax -- aws passes null when there are no query parameters
  if (entries.length === 0) return { single: null, multi: null };

  return {
    single: Object.fromEntries(entries.map(([key, value]) => [key, toValues(value).at(-1) ?? ''])),
    multi: Object.fromEntries(entries.map(([key, value]) => [key, toValues(value)])),
  };
};

/** the event that API Gateway passes to a lambda for a request (proxy integration, payload format 1.0), made from the request as the server hands it to a worker */
const createLambdaEvent = (workerEvent: WorkerRequestEvent, body?: Buffer): RequestEvent => {
  const {
    path,
    httpMethod,
    requestId,
    httpVersion,
    pathParameters,
    remoteAddress,
    queryStringParameters,
    rawHeaders = [],
    headers: joinedHeaders,
  } = workerEvent;
  const { single, multi } = toQueryParameters(queryStringParameters);
  const { headers, multiValueHeaders } = parseRawHeaders(rawHeaders);
  const now = new Date();
  const proxy = path.replace(/^\//, '');

  return Object.assign(new RequestEvent(), {
    resource: proxy === '' ? '/' : '/{proxy+}',
    path,
    httpMethod,
    headers,
    multiValueHeaders,
    queryStringParameters: single,
    multiValueQueryStringParameters: multi,
    // the captures of a route are what the route is about, the rest of the path is only the proxy resource when nothing named it
    // eslint-disable-next-line no-restricted-syntax -- aws passes null when there are no path parameters
    pathParameters: pathParameters ?? (proxy === '' ? null : { proxy }),
    // eslint-disable-next-line no-restricted-syntax -- aws passes null when the stage has no variables
    stageVariables: null,
    requestContext: {
      accountId: '000000000000',
      apiId: 'node-webserver',
      stage: '$default',
      requestId,
      resourcePath: proxy === '' ? '/' : '/{proxy+}',
      httpMethod,
      path,
      protocol: `HTTP/${httpVersion}`,
      requestTime: now.toUTCString(),
      requestTimeEpoch: now.getTime(),
      domainName: joinedHeaders.host ?? '',
      identity: { sourceIp: remoteAddress, userAgent: joinedHeaders['user-agent'] ?? '' },
    },
    ...encodeBody(body),
  });
};

export default createLambdaEvent;
