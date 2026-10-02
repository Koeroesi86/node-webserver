const path = require('path');

module.exports = {
  fileLogPath: false,
  logLevels: {
    system: true,
    info: true,
    success: true,
    error: true,
    warning: true,
  },
  portHttp: 80,
  portHttps: 443,
  portLookup: false,
  statsDomain: 'stats.localhost', // set to false to disable
  statsRefreshInterval: 10000,
  servers: [
    path.resolve(__dirname, 'examples/workerServer.js')
  ]
}