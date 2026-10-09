import http2 from 'http2';
import https from 'https';
import type http from 'http';
import type { Express } from 'express';
import type { SecureContext } from 'tls';
import { DEFAULT_KEEP_ALIVE_TIMEOUT } from '../constants';
import type { Configuration } from '../types';

export interface HttpsApps {
  /** the app for HTTP/1 */
  http1: Express;
  /** the app for HTTP/2, used when `http2` is on */
  http2: Express;
}

/**
 * The server of the https port, which picks the certificate by the name of the host the client asks for. With `http2` on it speaks HTTP/2 to the clients that
 * offer it and HTTP/1.1 (and websockets) to the others, on the same port.
 */
const createHttpsServer = (
  contexts: Record<string, SecureContext | undefined>,
  apps: HttpsApps,
  { http2: useHttp2 = false, keepAliveTimeout = DEFAULT_KEEP_ALIVE_TIMEOUT }: Pick<Configuration, 'http2' | 'keepAliveTimeout'>
): https.Server | http2.Http2SecureServer => {
  const options = {
    SNICallback: (domain: string, callback: (error: Error | null, context?: SecureContext) => void) => {
      const secureContext = contexts[domain];
      // without an answer the handshake of a host that has no certificate would wait until the client gives up
      if (!secureContext) return callback(new Error(`No certificate for ${domain}.`));
      callback(null, secureContext);
    },
  };

  if (!useHttp2) return https.createServer(options, apps.http1);

  const server = http2.createSecureServer({ ...options, allowHTTP1: true });
  // the types of node only know the requests of HTTP/2 here, but with allowHTTP1 the ones of HTTP/1 come too, and each goes to the app that is made for it
  server.on('request', (request: http.IncomingMessage, response: http.ServerResponse) =>
    (request.httpVersionMajor >= 2 ? apps.http2 : apps.http1)(request, response)
  );
  // what keepAliveTimeout is for a connection of HTTP/1: an idle one is closed, once its streams are done
  server.on('session', (session) => session.setTimeout(keepAliveTimeout, () => session.close()));

  return server;
};

export default createHttpsServer;
