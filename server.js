const express = require('express');
const http = require('http');
const https = require('https');
const { SERVERS } = require('./configuration');
const spawnProcesses = require('./utils/spawnProcesses');
const setupChildListeners = require('./utils/setupChildListeners');
const addExitListeners = require('./utils/exitHandler');
const { findPorts } = require('./utils/ports');
const { PORTS } = require('./configuration');
const setupSecureContexts = require('./utils/setupSecureContexts');
const setupStatsHandler = require('./utils/setupStatsHandler');
const setupVirtualHosts = require('./utils/setupVirtualHosts');

process.chdir(__dirname);

const httpApp = express();
const httpsApp = express();

findPorts()
  .then(() => {
    const instances = SERVERS.slice();

    /** @var {Array} instances */
    spawnProcesses(instances);

    /** stdout listeners setup */
    setupChildListeners(instances);

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
    console.error(error);
  });
