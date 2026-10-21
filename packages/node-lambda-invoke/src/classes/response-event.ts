import type { OutgoingHttpHeaders } from 'http';

class ResponseEvent {
  declare statusCode?: number;
  declare headers?: OutgoingHttpHeaders;
  /** a header with several values, added to `headers` */
  declare multiValueHeaders?: Record<string, string[]>;
  /** the `Set-Cookie` headers of the response (payload format 2.0 of API Gateway) */
  declare cookies?: string[];
  declare body?: string;
  declare isBase64Encoded?: boolean;
}

export default ResponseEvent;
