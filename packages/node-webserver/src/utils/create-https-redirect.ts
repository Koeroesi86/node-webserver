import getHostname from './get-hostname';
import getURL from './get-url';
import type { RequestHandler } from 'express';
import type { ServerConfig } from '../types';

/** answers a plain http request with a redirect to the same address on https, on the name the client asked for (a wildcard host has many) */
const createHttpsRedirect = (redirect: Exclude<ServerConfig['redirectHttp'], false | undefined>, portHttps?: number): RequestHandler => {
  const status = redirect === true ? 308 : (redirect.status ?? 308);

  return (request, response, next) => {
    const hostname = getHostname(request.headers.host);

    if (!hostname) {
      next();
      return;
    }

    response.redirect(status, `${getURL('https', hostname, portHttps)}${request.originalUrl}`);
  };
};

export default createHttpsRedirect;
