import { readFileSync } from 'fs';
import type { RequestHandler } from 'express';
import { DEFAULT_CONTROL_PATH, DEFAULT_PROXY_TIMEOUT } from '../constants';
import createProxyTarget from '../utils/create-proxy-target';
import createTargetStore from '../utils/create-target-store';
import getDate from '../utils/getDate';
import logger from '../utils/logger';
import proxyRequest from '../utils/proxy-request';
import setForwardedHeaders from '../utils/set-forwarded-headers';
import proxyControl from './proxy-control';
import type { ServerInstance } from '../types';

/**
 * A `proxy` server: passes the requests of its host, websockets included, to a fixed `target`, or to the one the service behind it registers on the control path
 * of the host (`dynamic`). Without a target (yet, or expired) requests are answered with 503.
 */
const proxyServerMiddleware = (instance: ServerInstance): RequestHandler => {
  const { hostname, protocol, proxyOptions = {} } = instance;
  const { target, dynamic, changeOrigin, secure, hideHeaders = [], forwardedHeaders, proxyTimeout = DEFAULT_PROXY_TIMEOUT } = proxyOptions;
  const ca = proxyOptions.ca ? readFileSync(proxyOptions.ca, 'utf8') : undefined;
  const requestOptions = { changeOrigin, hideHeaders: hideHeaders.map((name) => name.toLowerCase()), timeout: proxyTimeout };

  if (Boolean(target) === Boolean(dynamic)) {
    throw new Error(`proxy server ${hostname} needs either a target or a dynamic one in its proxyOptions.`);
  }

  if (target) {
    if (typeof target !== 'string' || !URL.canParse(target)) {
      throw new Error(`the target of proxy server ${hostname} must be a URL.`);
    }

    const fixed = createProxyTarget(new URL(target), { secure, ca });

    return (request, response) => {
      setForwardedHeaders(request, forwardedHeaders);
      proxyRequest(request, response, fixed, requestOptions);
    };
  }

  const options = dynamic ?? {};
  const token = options.token ?? (options.tokenEnv ? process.env[options.tokenEnv] : undefined);
  const controlPath = options.controlPath ?? DEFAULT_CONTROL_PATH;

  if (!token) {
    throw new Error(`the dynamic target of proxy server ${hostname} needs a token: name the environment variable that holds it in dynamic.tokenEnv.`);
  }

  if (protocol !== 'https') {
    logger.warning(`[${getDate()}] ${hostname} is served over http: its control path only accepts requests that a trusted proxy received over HTTPS.`);
  }

  const store = createTargetStore({ persistPath: options.persistPath, secure, ca });
  const control = proxyControl({ ...options, hostname, token, store });

  return (request, response, next) => {
    // the control path belongs to the server, it never reaches the target
    if (request.path === controlPath) return control(request, response, next);

    const current = store.get();
    if (!current) {
      response.status(503).type('text/plain').send('No server is registered behind this host.');
      return;
    }

    setForwardedHeaders(request, forwardedHeaders);
    proxyRequest(request, response, current, requestOptions);
  };
};

export default proxyServerMiddleware;
