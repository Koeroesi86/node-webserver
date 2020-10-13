const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const addExitListeners = require('../utils/exitHandler');
const { findPorts } = require('../utils/ports');
const setupSecureContexts = require('../utils/setupSecureContexts');
const setupStatsHandler = require('../utils/setupStatsHandler');
const setupVirtualHosts = require('../utils/setupVirtualHosts');
const accessLogsMiddleware = require('../middlewares/accessLogs');
const logger = require('../utils/logger');
const Configuration = require(process.env.NODE_WEBSERVER_CONFIG || '../configuration');

const { SERVERS, PORTS } = Configuration;
// process.chdir(__dirname);

const httpApp = express();
const httpsApp = express();

findPorts()
  .then(() => {
    const instances = SERVERS.slice().map(config => {
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
    setupStatsHandler(instances, httpApp, Configuration);

    setupVirtualHosts(instances, httpApp, httpsApp, Configuration);
    setupSecureContexts(instances);
    const contexts = instances
      .slice()
      .filter(inst => inst.serverOptions.protocol === 'https')
      .reduce((result, instance) => ({
        ...result,
        [instance.serverOptions.hostname]: instance.serverOptions.secureContext
      }), {});

    httpApp.disable('x-powered-by');
    httpsApp.disable('x-powered-by');

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

    httpServer.listen(PORTS.http);
    httpsServer.listen(PORTS.https);

    addExitListeners(instances);
  })
  .catch(error => {
    logger.error(error);
  });
