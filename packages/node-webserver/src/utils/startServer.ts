import express from 'express';
import type { Express, RequestHandler } from 'express';
import http from 'http';
import type net from 'net';
import type { SecureContext } from 'tls';
import { getLambdaStats } from '@koeroesi86/node-lambda-invoke';
import { createWorkerBudget, registerMetricsSource } from '@koeroesi86/node-worker-express';
import exampleConfig from '../configuration.example';
import accessLogsMiddleware from '../middlewares/accessLogs';
import { DEFAULT_SHUTDOWN_TIMEOUT, RELOAD_DEBOUNCE, RETIRE_TIMEOUT } from '../constants';
import addExitListeners from './exitHandler';
import configureServer from './configureServer';
import createGracefulStop from './create-graceful-stop';
import createContextLookup from './create-context-lookup';
import createHttp2App from './create-http2-app';
import createHttpsServer from './create-https-server';
import debounce from './debounce';
import getDate from './getDate';
import getWatchedFiles from './get-watched-files';
import loadInstances from './load-instances';
import logger from './logger';
import setupStatsHandler from './setupStatsHandler';
import setupVirtualHosts from './setupVirtualHosts';
import watchFiles from './watch-files';
import type { Configuration, LoadedInstance } from '../types';

const httpApp = express();
const httpsApp = express();
// the requests of HTTP/2 on the https port, which express 4 cannot serve with the app of HTTP/1
const http2App = createHttp2App();

httpApp.disable('x-powered-by');
httpsApp.disable('x-powered-by');

const listen = (server: net.Server, port: number) => new Promise<void>((resolve) => server.listen(port, () => resolve()));

const startServer = async (configuration: Partial<Configuration>): Promise<{ httpApp: Express; httpsApp: Express; reload: () => void }> => {
  const hydratedConfiguration: Configuration = {
    ...exampleConfig,
    ...configuration,
  };
  const { servers, watchServers = true, reloadOnSighup = false, trustedProxies = [], shutdownTimeout = DEFAULT_SHUTDOWN_TIMEOUT } = hydratedConfiguration;
  // before the hosts are set up, as the client address and the protocol of every request depend on it
  httpApp.set('trust proxy', Array.isArray(trustedProxies) ? trustedProxies : (trustedProxies.http ?? []));
  [httpsApp, http2App].forEach((app) => app.set('trust proxy', Array.isArray(trustedProxies) ? trustedProxies : (trustedProxies.https ?? [])));
  // one for the whole process, so that the workers of the servers that are loaded again count against the same limit
  const workerBudget = createWorkerBudget(hydratedConfiguration.workerLimit);
  registerMetricsSource('workers', workerBudget.getStats);

  /** what the requests and connections are handed to, swapped as a whole when the servers are loaded again, while the ones that were handed to the old ones finish there */
  let loaded: LoadedInstance[] = [];
  let hosts: Record<'http' | 'https', RequestHandler> = setupVirtualHosts([], configuration);
  let findContext: (domain: string) => SecureContext | undefined = () => undefined;
  /** the servers that were replaced and still answer the requests they took */
  const retiring = new Set<LoadedInstance>();
  let stopWatching = () => {};

  const apply = (next: LoadedInstance[]) => {
    const added = next.filter((instance) => !loaded.includes(instance));
    const removed = loaded.filter((instance) => !next.includes(instance));

    hosts = setupVirtualHosts(next, configuration);
    findContext = createContextLookup(
      next
        .filter(({ instance }) => instance.protocol === 'https')
        .map(({ instance }) => ({ hostname: instance.hostname, secureContext: instance.secureContext }))
    );
    loaded = next;

    added.forEach(({ instance }) => logger.system(`[${getDate()}] Server started for ${instance.url}`));
    removed.forEach((instance) => {
      retiring.add(instance);
      instance.close(RETIRE_TIMEOUT).finally(() => retiring.delete(instance));
    });

    return { added, removed };
  };

  const reload = () => {
    try {
      const { added, removed } = apply(loadInstances(servers, loaded, workerBudget));
      logger.system(`[${getDate()}] Servers loaded again: ${added.length} started, ${removed.length} stopped once their requests are answered`);
    } catch (error) {
      logger.error(`[${getDate()}] The servers were not loaded again, the running ones are kept:`, error);
    }

    // the files of the servers can be others now
    if (watchServers) watch();
  };

  const watch = () => {
    stopWatching();
    stopWatching = watchFiles(getWatchedFiles(servers, loaded), debounce(reload, RELOAD_DEBOUNCE));
  };

  apply(loadInstances(servers, [], workerBudget));

  /** access logs */
  httpApp.use(accessLogsMiddleware({ alias: 'http' }));
  const logHttps = accessLogsMiddleware({ alias: 'https' });
  [httpsApp, http2App].forEach((app) => app.use(logHttps));

  /** overall stats endpoint */
  setupStatsHandler(() => loaded.map(({ instance }) => instance), httpApp, configuration);

  httpApp.use((request, response, next) => hosts.http(request, response, next));
  // the hosts are the same for HTTP/1 and HTTP/2, so a worker pool is not started twice
  [httpsApp, http2App].forEach((app) => app.use((request, response, next) => hosts.https(request, response, next)));

  const httpServer = http.createServer(httpApp);
  // the certificates of the servers that are loaded again are looked up when a client connects
  const httpsServer = createHttpsServer((domain) => findContext(domain), { http1: httpsApp, http2: http2App }, hydratedConfiguration);

  configureServer(httpServer, 'http', hydratedConfiguration);
  configureServer(httpsServer, 'https', hydratedConfiguration);
  registerMetricsSource('lambdas', getLambdaStats);

  await listen(httpServer, hydratedConfiguration.portHttp);
  await listen(httpsServer, hydratedConfiguration.portHttps);

  const gracefulStop = createGracefulStop([httpServer, httpsServer], (timeout) => Promise.all(loaded.map(({ close }) => close(timeout))).then(() => undefined));
  addExitListeners(() => [...loaded, ...retiring].map(({ instance }) => instance), {
    exitOnHangUp: !reloadOnSighup,
    gracefulStop: () => gracefulStop(shutdownTimeout),
  });
  if (watchServers) watch();
  if (reloadOnSighup) process.on('SIGHUP', reload);

  return { httpApp, httpsApp, reload };
};

export default startServer;
