const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const exampleConfig = require('../configuration.example');
const accessLogsMiddleware = require('../middlewares/accessLogs');
const addExitListeners = require('./exitHandler');
const setupSecureContexts = require('./setupSecureContexts');
const setupStatsHandler = require('./setupStatsHandler');
const setupVirtualHosts = require('./setupVirtualHosts');

const httpApp = express();
const httpsApp = express();

httpApp.disable('x-powered-by');
httpsApp.disable('x-powered-by');

module.exports = async (configuration) => {
  const hydratedConfiguration = {
    ...exampleConfig,
    ...configuration,
  };
  const { servers, httpPort, httpsPort } = hydratedConfiguration;
  const instances = servers.slice().map(config => {
    if (typeof config === 'string') {
      const configPath = path.resolve(config);

      if (!fs.existsSync(configPath)) {
        return false;
      }

      return require(configPath);
    }
    return config;
  }).filter(Boolean);
  /** access logs */
  httpApp.use(accessLogsMiddleware({ alias: 'http' }));
  httpsApp.use(accessLogsMiddleware({ alias: 'https' }));

  /** overall stats endpoint */
  setupStatsHandler(instances, httpApp, configuration);

  setupVirtualHosts(instances, httpApp, httpsApp, configuration);
  setupSecureContexts(instances);
  const contexts = instances
    .slice()
    .filter(inst => inst.serverOptions.protocol === 'https')
    .reduce((result, instance) => ({
      ...result,
      [instance.serverOptions.hostname]: instance.serverOptions.secureContext
    }), {});

  const httpServer = http.createServer(httpApp);
  const httpsServer = https.createServer({
    SNICallback: (domain, callback) => {
      const secureContext = contexts[domain];
      if (secureContext) {
        if (callback) {
          return callback(null, secureContext);
        }

        return secureContext;
      }

      return null;
    }
  }, httpsApp);

  await new Promise((resolve, reject) => httpServer.listen(httpPort, (err) => {
    if (err) reject(err);
    resolve();
  }));
  await new Promise((resolve, reject) => httpsServer.listen(httpsPort, (err) => {
    if (err) reject(err);
    resolve();
  }));

  addExitListeners(instances);
  return { httpApp, httpsApp };
}
