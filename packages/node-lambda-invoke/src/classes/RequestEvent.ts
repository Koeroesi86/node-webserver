import type { RequestContext } from '../types';

/** the event of the proxy integration of API Gateway (payload format 1.0), which is what a lambda behind a REST API receives */
class RequestEvent {
  declare resource: string;
  declare path: string;
  declare httpMethod: string;
  /** the names as the client wrote them, the last value of a header that came more than once */
  declare headers: Record<string, string>;
  declare multiValueHeaders: Record<string, string[]>;
  /** the last value of a parameter that came more than once, `null` when there are none */
  declare queryStringParameters: Record<string, string> | null;
  declare multiValueQueryStringParameters: Record<string, string[]> | null;
  declare pathParameters: Record<string, string> | null;
  declare stageVariables: Record<string, string> | null;
  declare requestContext: RequestContext;
  /** `null` for a request without a body */
  declare body: string | null;
  /** the body is base64 when it is not valid UTF-8 */
  declare isBase64Encoded: boolean;
}

export default RequestEvent;
