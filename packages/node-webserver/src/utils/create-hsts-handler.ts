import { DEFAULT_HSTS_MAX_AGE } from '../constants';
import type { RequestHandler } from 'express';
import type { ServerConfig } from '../types';

/** sets `Strict-Transport-Security` on the responses, before the server of the host writes them */
const createHstsHandler = (hsts: Exclude<ServerConfig['hsts'], false | undefined>): RequestHandler => {
  const { maxAge = DEFAULT_HSTS_MAX_AGE, includeSubDomains, preload } = hsts === true ? {} : hsts;
  const value = [`max-age=${maxAge}`, includeSubDomains && 'includeSubDomains', preload && 'preload'].filter(Boolean).join('; ');

  return (request, response, next) => {
    response.setHeader('Strict-Transport-Security', value);
    next();
  };
};

export default createHstsHandler;
