const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { SERVERS } = require('../configuration');
const addExitListeners = require('../utils/exitHandler');
const { findPorts } = require('../utils/ports');
const { PORTS } = require('../configuration');
const setupSecureContexts = require('../utils/setupSecureContexts');
const setupStatsHandler = require('../utils/setupStatsHandler');
const setupVirtualHosts = require('../utils/setupVirtualHosts');
const setupAccessLogs = require('../utils/setupAccessLogs');
const logger = require('../utils/logger');

process.chdir(__dirname);

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
    setupAccessLogs(httpApp, 'http');
    setupAccessLogs(httpsApp, 'https');

    /** overall stats endpoint */
    setupStatsHandler(instances, httpApp);

    /** proxy listener vhosts */
    setupVirtualHosts(instances, httpApp, httpsApp);
    setupSecureContexts(instances);

    httpApp.disable('x-powered-by');
    httpsApp.disable('x-powered-by');

    const httpServer = http.createServer(httpApp);
    const httpsServer = https.createServer({
      SNICallback: (domain, callback) => {
        const instance = instances.find(inst => inst.serverOptions.hostname === domain && inst.serverOptions.protocol === 'https');
        if (instance) {
          const { secureContext } = instance.serverOptions;

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
