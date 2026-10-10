import express from 'express';
import type { Express } from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import fs from 'fs';
import { getLambdaStats } from '@koeroesi86/node-lambda-invoke';
import { createWorkerBudget, registerMetricsSource } from '@koeroesi86/node-worker-express';
import exampleConfig from '../configuration.example';
import accessLogsMiddleware from '../middlewares/accessLogs';
import addExitListeners from './exitHandler';
import configureServer from './configureServer';
import setupSecureContexts from './setupSecureContexts';
import setupStatsHandler from './setupStatsHandler';
import setupVirtualHosts from './setupVirtualHosts';
import type { Configuration, ServerInstance } from '../types';

const httpApp = express();
const httpsApp = express();

httpApp.disable('x-powered-by');
httpsApp.disable('x-powered-by');

const loadInstance = (configPath: string): ServerInstance[] => {
  const resolvedPath = path.resolve(configPath);

  if (!fs.existsSync(resolvedPath)) {
    return [];
  }

  const instance: ServerInstance = require(resolvedPath);

  return [instance];
};

const listen = (server: http.Server | https.Server, port: number) => new Promise<void>((resolve) => server.listen(port, () => resolve()));

const startServer = async (configuration: Partial<Configuration>): Promise<{ httpApp: Express; httpsApp: Express }> => {
  const hydratedConfiguration: Configuration = {
    ...exampleConfig,
    ...configuration,
  };
  const instances = hydratedConfiguration.servers.flatMap((config) => (typeof config === 'string' ? loadInstance(config) : [config]));
  /** access logs */
  httpApp.use(accessLogsMiddleware({ alias: 'http' }));
  httpsApp.use(accessLogsMiddleware({ alias: 'https' }));

  /** overall stats endpoint */
  setupStatsHandler(instances, httpApp, configuration);

  const workerBudget = createWorkerBudget(hydratedConfiguration.workerLimit);
  registerMetricsSource('workers', workerBudget.getStats);
  setupVirtualHosts(instances, httpApp, httpsApp, configuration, workerBudget);
  setupSecureContexts(instances);
  const contexts = Object.fromEntries(instances.filter((inst) => inst.protocol === 'https').map((instance) => [instance.hostname, instance.secureContext]));

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

  addExitListeners(instances);
  return { httpApp, httpsApp };
};

export default startServer;
