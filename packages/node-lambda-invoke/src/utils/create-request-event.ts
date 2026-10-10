import type { IncomingMessage } from 'http';
import RequestEvent from '../classes/RequestEvent';
import parseQueryString from './parse-query-string';
import parseRawHeaders from './parse-raw-headers';

const decoder = new TextDecoder('utf-8', { fatal: true });

/** the text of the body when it is valid UTF-8, otherwise the bytes in base64 */
const encodeBody = (body: Buffer | undefined) => {
  if (body === undefined) return { body: null, isBase64Encoded: false };

  try {
    return { body: decoder.decode(body), isBase64Encoded: false };
  } catch {
    return { body: body.toString('base64'), isBase64Encoded: true };
  }
};

/** the event that API Gateway passes to a lambda for a request (proxy integration, payload format 1.0) */
const createRequestEvent = (request: IncomingMessage, requestId: string, body?: Buffer, routeParameters?: Record<string, string>): RequestEvent => {
  const url = request.url ?? '/';
  const queryStart = url.indexOf('?');
  const path = (queryStart === -1 ? url : url.slice(0, queryStart)) || '/';
  const { single, multi } = parseQueryString(queryStart === -1 ? '' : url.slice(queryStart + 1));
  const { headers, multiValueHeaders } = parseRawHeaders(request.rawHeaders);
  const httpMethod = request.method?.toUpperCase() ?? '';
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
    pathParameters: routeParameters ?? (proxy === '' ? null : { proxy }),
    stageVariables: null,
    requestContext: {
      accountId: '000000000000',
      apiId: 'node-webserver',
      stage: '$default',
      requestId,
      resourcePath: proxy === '' ? '/' : '/{proxy+}',
      httpMethod,
      path,
      protocol: `HTTP/${request.httpVersion}`,
      requestTime: now.toUTCString(),
      requestTimeEpoch: now.getTime(),
      domainName: request.headers.host ?? '',
      identity: { sourceIp: request.socket.remoteAddress ?? '', userAgent: request.headers['user-agent'] ?? '' },
    },
    ...encodeBody(body),
  });
};

export default createRequestEvent;
