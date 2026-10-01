import type { IncomingHttpHeaders } from 'http';
import type { ParsedUrlQuery } from 'querystring';

class RequestEvent {
  declare path: string;
  declare headers: IncomingHttpHeaders;
  declare pathParameters?: Record<string, string>;
  declare requestContext?: object;
  declare resource?: string;
  declare httpMethod: string;
  declare queryStringParameters: ParsedUrlQuery;
  declare stageVariables?: Record<string, string>;
}

export default RequestEvent;
