import type { RequestHandler, Response } from 'express';
import { CONTROL_BODY_LIMIT, CONTROL_FAILURES_PER_WINDOW, CONTROL_RATE_WINDOW, CONTROL_UPDATES_PER_WINDOW } from '../constants';
import createRateLimiter from '../utils/create-rate-limiter';
import getClientAddress from '../utils/get-client-address';
import getDate from '../utils/getDate';
import logger from '../utils/logger';
import readBody from '../utils/read-body';
import resolveRegisteredTarget from '../utils/resolve-registered-target';
import tokensMatch from '../utils/tokens-match';
import type { DynamicTargetOptions, ProxyTarget, TargetStore } from '../types';

interface ControlOptions extends DynamicTargetOptions {
  hostname: string;
  token: string;
  store: TargetStore;
}

const send = (response: Response, status: number, body?: object) => (body ? response.status(status).json(body) : response.status(status).end());

const describe = ({ url, setAt, expiresAt }: ProxyTarget) => ({
  target: url.href,
  setAt: new Date(setAt).toISOString(),
  expiresAt: expiresAt === undefined ? undefined : new Date(expiresAt).toISOString(),
});

const parse = (text: string): unknown => {
  try {
    return text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * The control path of a `proxy` host with a dynamic target, where the service behind it registers where it is (PUT), reads it (GET) or removes it (DELETE),
 * with the token of this host, over HTTPS only. The token is never logged, and an address that fails too often is refused for the rest of the window.
 */
const proxyControl = (options: ControlOptions): RequestHandler => {
  const { hostname, token, store, ttl } = options;
  const failures = createRateLimiter(CONTROL_FAILURES_PER_WINDOW, CONTROL_RATE_WINDOW);
  const updates = createRateLimiter(CONTROL_UPDATES_PER_WINDOW, CONTROL_RATE_WINDOW);

  return async (request, response) => {
    const client = getClientAddress(request);
    const [scheme, sent = ''] = (request.headers.authorization ?? '').split(' ');

    // the token would travel in clear text, a trusted load balancer that ends TLS says so in X-Forwarded-Proto
    if (!request.secure) return send(response, 403, { error: 'The control path only accepts HTTPS.' });
    if (failures.exceeded(client)) return send(response, 429, { error: 'Too many failed attempts, try again later.' });
    if (scheme !== 'Bearer' || !tokensMatch(sent, token)) {
      failures.hit(client);
      response.set('WWW-Authenticate', 'Bearer');
      return send(response, 401, { error: 'The token of this host is needed.' });
    }

    if (request.method === 'GET') {
      const current = store.get();
      return current ? send(response, 200, describe(current)) : send(response, 404, { error: 'No target is set.' });
    }

    if (request.method === 'DELETE') {
      store.unset();
      logger.info(`[${getDate()}] The target of ${hostname} was removed by ${client}.`);
      return send(response, 204);
    }

    if (request.method !== 'PUT') {
      response.set('Allow', 'GET, PUT, DELETE');
      return send(response, 405, { error: 'Only GET, PUT and DELETE are answered here.' });
    }

    if (updates.exceeded(hostname)) return send(response, 429, { error: 'Too many updates, try again later.' });
    updates.hit(hostname);

    const text = await readBody(request, CONTROL_BODY_LIMIT).catch(() => undefined);
    if (text === undefined) return send(response, 413, { error: `The body must not be larger than ${CONTROL_BODY_LIMIT} bytes.` });

    const body = parse(text);
    if (body === undefined) return send(response, 400, { error: 'The body must be JSON.' });

    const resolved = resolveRegisteredTarget(body, client, options);
    if ('error' in resolved) return send(response, resolved.status, { error: resolved.error });

    const target = store.set(resolved.url, ttl ? Date.now() + ttl * 1000 : undefined);
    logger.info(`[${getDate()}] The target of ${hostname} was set to ${target.url.href} by ${client}.`);
    return send(response, 200, describe(target));
  };
};

export default proxyControl;
