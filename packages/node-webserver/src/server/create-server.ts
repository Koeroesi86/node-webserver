import express from 'express';
import type { Express } from 'express';
import http from 'http';
import type net from 'net';
import { createLambdaStats } from '@koeroesi86/node-lambda-invoke';
import { createWorkerBudget } from '@koeroesi86/node-worker-express';
import { accessLogs as accessLogsMiddleware } from '../middlewares';
import { applyTrustedProxies, createHttp2App } from '../request';
import { configureServer, hydrateConfiguration, validateConfiguration } from '../configuration';
import { createAcmeChallengeHandler, createAcmeRenewer } from '../acme';
import { splitConfigurationLimits } from '../cluster';
import { createCompressionBudget } from '../compression';
import { createHttpsServer } from '../tls';
import { createLogger, registerServerMetrics, setupStatsHandler } from '../observability';
import { createServerReloader, getLoadFingerprint } from '../reload';
import { reportProblems } from '../problems';
import { createServerStop, setupProcessHooks } from '../lifecycle';
import loadInstances from './load-instances';
import type { AcmeChallenges, Configuration, FrontShare, LoadReport, Logger, PreparedServers, SignalSource } from '../types';

const listen = (server: net.Server, port: number) => new Promise<void>((resolve) => server.listen(port, () => resolve()));

export interface ServerOptions {
  processHooks?: boolean;
  /** set in a front process, which runs its share of the limits */
  front?: FrontShare;
  /** where the signals of the process hooks come from, the process by default */
  signals?: SignalSource;
  /** whether the server is stopped with `stop`, which needs its connections tracked from the start */
  stoppable?: boolean;
  /** for a server that is not to load its servers on its own, as a primary has all fronts do it together: asks for it. Such a server watches no file. */
  requestReload?: () => void;
}

export interface RunningServer {
  httpApp: Express;
  httpsApp: Express;
  reload: () => void;
  removeProcessHooks: () => void;
  /** stops softly, within `shutdownTimeout`. Only for a `stoppable` server. */
  stop: () => Promise<void>;
  /** loads the servers and starts what is new, without serving from it yet */
  prepare: () => PreparedServers;
  /** the files to watch, and what was loaded */
  report: (servers?: PreparedServers) => LoadReport;
}

/** the server of one process: both listening servers with everything behind them */
const createServer = async (
  configuration: Partial<Configuration>,
  logger?: Logger,
  { processHooks = true, front, signals, stoppable = false, requestReload }: ServerOptions = {}
): Promise<RunningServer> => {
  // one set for each call, so that a second server in the process does not share the middlewares of the first
  const httpApp = express();
  const httpsApp = express();
  // the requests of HTTP/2 on the https port, which express 4 cannot serve with the app of HTTP/1
  const http2App = createHttp2App();
  httpApp.disable('x-powered-by');
  httpsApp.disable('x-powered-by');

  const wholeConfiguration = hydrateConfiguration(configuration);
  // the lines that wait are written when the process exits, by the exit listeners that setupShutdown adds
  const log = logger ?? createLogger(wholeConfiguration);
  // before anything is created that has to be stopped again
  reportProblems(validateConfiguration(configuration), log);
  const hydratedConfiguration = front ? splitConfigurationLimits(wholeConfiguration, front) : wholeConfiguration;
  const { servers, watchServers, reloadOnSighup, trustedProxies, shutdownTimeout } = hydratedConfiguration;
  // before the hosts are set up, as the client address and the protocol of every request depend on it
  applyTrustedProxies(trustedProxies, [httpApp], [httpsApp, http2App]);
  // one for the whole process, so that the workers of the servers that are loaded again count against the same limit
  const workerBudget = createWorkerBudget(hydratedConfiguration.workerLimit);
  // one for the server too, so that the lambdas of a second server in the process do not count in the stats of this one
  const lambdaStats = createLambdaStats();
  const unregisterMetrics = registerServerMetrics(workerBudget.getStats, lambdaStats);
  // and the limit of the compressed responses, which every server of the process has for itself
  const compressionBudget = createCompressionBudget();

  const reloader = createServerReloader(
    servers,
    configuration,
    watchServers && !requestReload,
    (previous) => loadInstances(servers, previous, log, { workerBudget, lambdaStats, compressionBudget, configuration, front }),
    log
  );
  const { watch } = reloader;
  const reload = requestReload ?? reloader.reload;

  /** access logs */
  httpApp.use(accessLogsMiddleware({ alias: 'http', logger: log }));
  const logHttps = accessLogsMiddleware({ alias: 'https', logger: log });
  [httpsApp, http2App].forEach((app) => app.use(logHttps));

  /** the challenge of the certificate authority, before the hosts: a redirect to https must not get in its way */
  const challenges: AcmeChallenges = new Map();
  httpApp.use(createAcmeChallengeHandler(challenges));

  /** overall stats endpoint */
  setupStatsHandler(reloader.getLoaded, httpApp, configuration, log);

  httpApp.use(reloader.httpHandler);
  // the hosts are the same for HTTP/1 and HTTP/2, so a worker pool is not started twice
  [httpsApp, http2App].forEach((app) => app.use(reloader.httpsHandler));

  const httpServer = http.createServer(httpApp);
  // the certificates of the servers that are loaded again are looked up when a client connects
  const httpsServer = createHttpsServer(reloader.findContext, { http1: httpsApp, http2: http2App }, hydratedConfiguration);

  configureServer(httpServer, 'http', hydratedConfiguration);
  configureServer(httpsServer, 'https', hydratedConfiguration);
  // before the servers listen, so that it sees every connection
  const gracefulStop = stoppable ? createServerStop([httpServer, httpsServer], reloader.getLoaded) : undefined;

  await listen(httpServer, hydratedConfiguration.portHttp);
  await listen(httpsServer, hydratedConfiguration.portHttps);

  // the lines that wait in the logger are written by the exit listeners that the hooks add
  const hooks = setupProcessHooks(processHooks, [httpServer, httpsServer], workerBudget, {
    reloadOnSighup,
    shutdownTimeout,
    // the signal reaches the primary too, which has every front load the servers
    reload: requestReload ? () => {} : reload,
    getLoaded: reloader.getLoaded,
    getInstances: reloader.getInstances,
    logger: log,
    gracefulStop,
    signals,
  });
  // after the servers listen, as the authority comes to the http port
  const renewer = createAcmeRenewer({ getLoaded: reloader.getLoaded, challenges, logger: log, reload });
  void renewer.start();
  httpServer.once('close', () => {
    renewer.stop();
    unregisterMetrics();
    hooks.removeWorkerBudget();
  });
  if (watchServers && !requestReload) watch();

  const report = (servers?: PreparedServers) => ({
    files: reloader.getWatchedFiles(),
    fingerprint: getLoadFingerprint(servers?.instances ?? reloader.getLoaded(), configuration.unknownHostPage),
  });

  return {
    httpApp,
    httpsApp,
    reload,
    removeProcessHooks: hooks.remove,
    stop: async () => gracefulStop?.(shutdownTimeout),
    prepare: reloader.prepare,
    report,
  };
};

export default createServer;
