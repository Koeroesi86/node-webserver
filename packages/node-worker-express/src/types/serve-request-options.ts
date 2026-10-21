import type { MiddlewareOptions } from './middleware';

/** the options that decide how a request is served once a worker took it: hand-offs, timeouts and the limits of the body and of websocket connections */
export type ServeRequestOptions = Pick<
  MiddlewareOptions,
  | 'handOffRequests'
  | 'handOffResponses'
  | 'limitRequestBody'
  | 'limitResponseTimeout'
  | 'limitWebSocketMessage'
  | 'webSocketPingInterval'
  | 'limitWebSocketIdleTimeout'
>;
