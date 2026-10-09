import express from 'express';
import type { Express } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import type net from 'net';
import { getLambdaStats } from '@koeroesi86/node-lambda-invoke';
import { registerMetricsSource } from '@koeroesi86/node-worker-express';
import exampleConfig from '../configuration.example';
import accessLogsMiddleware from '../middlewares/accessLogs';
import addExitListeners from './exitHandler';
import configureServer from './configureServer';
import createHttp2App from './create-http2-app';
import createHttpsServer from './create-https-server';
import setupSecureContexts from './setupSecureContexts';
import setupStatsHandler from './setupStatsHandler';
import setupVirtualHosts from './setupVirtualHosts';
import type { Configuration, ServerInstance } from '../types';

const httpApp = express();
const httpsApp = express();
const http2App = createHttp2App();
// what is served on the https port, for HTTP/1 and HTTP/2 alike
const httpsRouter = express.Router();

httpApp.disable('x-powered-by');
httpsApp.disable('x-powered-by');
httpsApp.use(httpsRouter);
http2App.use(httpsRouter);

const loadInstance = (configPath: string): ServerInstance[] => {
  const resolvedPath = path.resolve(configPath);

  if (!fs.existsSync(resolvedPath)) {
    return [];
  }

  const instance: ServerInstance = require(resolvedPath);

  return [instance];
};

const listen = (server: net.Server, port: number) => new Promise<void>((resolve) => server.listen(port, () => resolve()));

const startServer = async (configuration: Partial<Configuration>): Promise<{ httpApp: Express; httpsApp: Express }> => {
  const hydratedConfiguration: Configuration = {
    ...exampleConfig,
    ...configuration,
  };
  const instances = hydratedConfiguration.servers.flatMap((config) => (typeof config === 'string' ? loadInstance(config) : [config]));
  /** access logs */
  httpApp.use(accessLogsMiddleware({ alias: 'http' }));
  httpsRouter.use(accessLogsMiddleware({ alias: 'https' }));

  /** overall stats endpoint */
  setupStatsHandler(instances, httpApp, configuration);

  setupVirtualHosts(instances, httpApp, httpsRouter, configuration);
  setupSecureContexts(instances);
  const contexts = Object.fromEntries(instances.filter((inst) => inst.protocol === 'https').map((instance) => [instance.hostname, instance.secureContext]));

  const httpServer = http.createServer(httpApp);
  const httpsServer = createHttpsServer(contexts, { http1: httpsApp, http2: http2App }, hydratedConfiguration);

  configureServer(httpServer, 'http', hydratedConfiguration);
  configureServer(httpsServer, 'https', hydratedConfiguration);
  registerMetricsSource('lambdas', getLambdaStats);

  await listen(httpServer, hydratedConfiguration.portHttp);
  await listen(httpsServer, hydratedConfiguration.portHttps);

  addExitListeners(instances);
  return { httpApp, httpsApp };
};

export default startServer;
