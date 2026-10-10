import express from 'express';
import type { Express, RequestHandler } from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import type { SecureContext } from 'tls';
import { getLambdaStats } from '@koeroesi86/node-lambda-invoke';
import { createWorkerBudget, registerMetricsSource } from '@koeroesi86/node-worker-express';
import exampleConfig from '../configuration.example';
import accessLogsMiddleware from '../middlewares/accessLogs';
import { RELOAD_DEBOUNCE, RETIRE_TIMEOUT } from '../constants';
import addExitListeners from './exitHandler';
import configureServer from './configureServer';
import debounce from './debounce';
import getDate from './getDate';
import loadInstances from './load-instances';
import logger from './logger';
import setupStatsHandler from './setupStatsHandler';
import setupVirtualHosts from './setupVirtualHosts';
import watchFiles from './watch-files';
import type { Configuration, LoadedInstance } from '../types';

const httpApp = express();
const httpsApp = express();

httpApp.disable('x-powered-by');
httpsApp.disable('x-powered-by');

const listen = (server: http.Server | https.Server, port: number) => new Promise<void>((resolve) => server.listen(port, () => resolve()));

/** the files a change of which changes the servers: the ones they were loaded from, the ones that do not exist yet, and their certificates */
const getWatchedFiles = (servers: Configuration['servers'], loaded: LoadedInstance[]) => [
  ...servers.filter((source): source is string => typeof source === 'string').map((source) => path.resolve(source)),
  ...loaded.flatMap(({ files }) => files),
  ...loaded.flatMap(({ instance: { key, cert, ca } }) => [key, cert, ca].filter((file): file is string => typeof file === 'string')),
];

const startServer = async (configuration: Partial<Configuration>): Promise<{ httpApp: Express; httpsApp: Express; reload: () => void }> => {
  const hydratedConfiguration: Configuration = {
    ...exampleConfig,
    ...configuration,
  };
  const { servers, watchServers = true, reloadOnSighup = false, trustedProxies = [] } = hydratedConfiguration;
  // before the hosts are set up, as the client address and the protocol of every request depend on it
  httpApp.set('trust proxy', Array.isArray(trustedProxies) ? trustedProxies : trustedProxies.http ?? []);
  httpsApp.set('trust proxy', Array.isArray(trustedProxies) ? trustedProxies : trustedProxies.https ?? []);
  // one for the whole process, so that the workers of the servers that are loaded again count against the same limit
  const workerBudget = createWorkerBudget(hydratedConfiguration.workerLimit);
  registerMetricsSource('workers', workerBudget.getStats);

  /** what the requests and connections are handed to, swapped as a whole when the servers are loaded again, while the ones that were handed to the old ones finish there */
  let loaded: LoadedInstance[] = [];
  let hosts: Record<'http' | 'https', RequestHandler> = setupVirtualHosts([], configuration);
  let contexts: Record<string, SecureContext | undefined> = {};
  /** the servers that were replaced and still answer the requests they took */
  const retiring = new Set<LoadedInstance>();
  let stopWatching = () => {};

  const apply = (next: LoadedInstance[]) => {
    const added = next.filter((instance) => !loaded.includes(instance));
    const removed = loaded.filter((instance) => !next.includes(instance));

    hosts = setupVirtualHosts(next, configuration);
    contexts = Object.fromEntries(
      next.filter(({ instance }) => instance.protocol === 'https').map(({ instance }) => [instance.hostname, instance.secureContext])
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
  httpsApp.use(accessLogsMiddleware({ alias: 'https' }));

  /** overall stats endpoint */
  setupStatsHandler(() => loaded.map(({ instance }) => instance), httpApp, configuration);

  httpApp.use((request, response, next) => hosts.http(request, response, next));
  httpsApp.use((request, response, next) => hosts.https(request, response, next));

  const httpServer = http.createServer(httpApp);
  const httpsServer = https.createServer(
    {
      SNICallback: (domain, callback) => {
        const secureContext = contexts[domain];
        if (secureContext) {
          callback(null, secureContext);
        }
      },
    },
    httpsApp
  );

  configureServer(httpServer, 'http', hydratedConfiguration);
  configureServer(httpsServer, 'https', hydratedConfiguration);
  registerMetricsSource('lambdas', getLambdaStats);

  await listen(httpServer, hydratedConfiguration.portHttp);
  await listen(httpsServer, hydratedConfiguration.portHttps);

  addExitListeners(() => [...loaded, ...retiring].map(({ instance }) => instance), { exitOnHangUp: !reloadOnSighup });
  if (watchServers) watch();
  if (reloadOnSighup) process.on('SIGHUP', reload);

  return { httpApp, httpsApp, reload };
};

export default startServer;
