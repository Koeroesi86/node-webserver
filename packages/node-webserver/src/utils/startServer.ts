import express from 'express';
import type { Express } from 'express';
import http from 'http';
import type net from 'net';
import { getLambdaStats } from '@koeroesi86/node-lambda-invoke';
import { createWorkerBudget, registerMetricsSource } from '@koeroesi86/node-worker-express';
import accessLogsMiddleware from '../middlewares/accessLogs';
import applyTrustedProxies from './apply-trusted-proxies';
import configureServer from './configureServer';
import createHttp2App from './create-http2-app';
import createHttpsServer from './create-https-server';
import createServerReloader from './create-server-reloader';
import hydrateConfiguration from './hydrate-configuration';
import loadInstances from './load-instances';
import setupShutdown from './setup-shutdown';
import setupStatsHandler from './setupStatsHandler';
import type { Configuration } from '../types';

const httpApp = express();
const httpsApp = express();
// the requests of HTTP/2 on the https port, which express 4 cannot serve with the app of HTTP/1
const http2App = createHttp2App();

httpApp.disable('x-powered-by');
httpsApp.disable('x-powered-by');

const listen = (server: net.Server, port: number) => new Promise<void>((resolve) => server.listen(port, () => resolve()));

const startServer = async (configuration: Partial<Configuration>): Promise<{ httpApp: Express; httpsApp: Express; reload: () => void }> => {
  const hydratedConfiguration = hydrateConfiguration(configuration);
  const { servers, watchServers, reloadOnSighup, trustedProxies, shutdownTimeout } = hydratedConfiguration;
  // before the hosts are set up, as the client address and the protocol of every request depend on it
  applyTrustedProxies(trustedProxies, [httpApp], [httpsApp, http2App]);
  // one for the whole process, so that the workers of the servers that are loaded again count against the same limit
  const workerBudget = createWorkerBudget(hydratedConfiguration.workerLimit);
  registerMetricsSource('workers', workerBudget.getStats);

  const reloader = createServerReloader(servers, configuration, watchServers, (previous) => loadInstances(servers, previous, workerBudget));
  const { reload, watch } = reloader;

  /** access logs */
  httpApp.use(accessLogsMiddleware({ alias: 'http' }));
  const logHttps = accessLogsMiddleware({ alias: 'https' });
  [httpsApp, http2App].forEach((app) => app.use(logHttps));

  /** overall stats endpoint */
  setupStatsHandler(reloader.getLoaded, httpApp, configuration);

  httpApp.use(reloader.httpHandler);
  // the hosts are the same for HTTP/1 and HTTP/2, so a worker pool is not started twice
  [httpsApp, http2App].forEach((app) => app.use(reloader.httpsHandler));

  const httpServer = http.createServer(httpApp);
  // the certificates of the servers that are loaded again are looked up when a client connects
  const httpsServer = createHttpsServer(reloader.findContext, { http1: httpsApp, http2: http2App }, hydratedConfiguration);

  configureServer(httpServer, 'http', hydratedConfiguration);
  configureServer(httpsServer, 'https', hydratedConfiguration);
  registerMetricsSource('lambdas', getLambdaStats);

  await listen(httpServer, hydratedConfiguration.portHttp);
  await listen(httpsServer, hydratedConfiguration.portHttps);

  setupShutdown([httpServer, httpsServer], { reloadOnSighup, shutdownTimeout, reload, getLoaded: reloader.getLoaded, getInstances: reloader.getInstances });
  if (watchServers) watch();

  return { httpApp, httpsApp, reload };
};

export default startServer;
