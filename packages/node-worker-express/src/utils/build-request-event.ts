import type { RequestEvent } from '@koeroesi86/node-worker-pool';
import type { Request } from 'express';
import type { ParsedUrlQuery } from 'querystring';
import getClientIp from './getClientIp';

interface RequestEventParams {
  request: Request;
  protocol: string;
  pathname: string;
  pathFragments: string[];
  query: ParsedUrlQuery;
  rootPath: string;
  pathParameters?: { [key: string]: string };
  streamsBody: boolean;
}

/** what the worker is told about a request */
const buildRequestEvent = ({ request, protocol, pathname, pathFragments, query, rootPath, pathParameters, streamsBody }: RequestEventParams): RequestEvent => ({
  httpMethod: request.method.toUpperCase(),
  protocol,
  path: pathname,
  pathFragments,
  queryStringParameters: { ...query },
  headers: request.headers as Record<string, string>,
  remoteAddress: getClientIp(request),
  rootPath,
  ...(pathParameters && { pathParameters }),
  // the body is not part of the event, the worker takes it from a stream while it arrives
  ...(streamsBody && { hasBody: true }),
});

export default buildRequestEvent;
