import type { RequestHandler } from 'express';
import type { AcmeChallenges } from '../types';

const PREFIX = '/.well-known/acme-challenge/';

/** answers the `http-01` challenge of the certificate authority with the key authorization of its token, and passes every other request on, before the virtual hosts */
const createAcmeChallengeHandler =
  (challenges: AcmeChallenges): RequestHandler =>
  (request, response, next) => {
    const answer = request.url.startsWith(PREFIX) ? challenges.get(request.url.slice(PREFIX.length).split('?')[0]) : undefined;

    if (answer === undefined || (request.method !== 'GET' && request.method !== 'HEAD')) {
      next();
      return;
    }

    response.setHeader('Content-Type', 'text/plain');
    response.end(request.method === 'HEAD' ? undefined : answer);
  };

export default createAcmeChallengeHandler;
