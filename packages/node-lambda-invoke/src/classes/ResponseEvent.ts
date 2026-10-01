import type { OutgoingHttpHeaders } from 'http';

class ResponseEvent {
  declare statusCode?: number;
  declare headers?: OutgoingHttpHeaders;
  declare body?: string;
  declare isBase64Encoded?: boolean;
}

export default ResponseEvent;
