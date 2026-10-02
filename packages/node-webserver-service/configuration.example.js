const path = require('path');

process.chdir(__dirname);

module.exports = {
  serviceName: 'node-webserver',
  serviceDisplayName: 'NodeJS Webserver',
  // fileLogPath: path.resolve(__dirname, './.logs/'),
  fileLogPath: null,
  logLevels: {
    system: true,
    info: true,
    success: true,
    error: true,
    warning: true,
  },
  // portHttp: 80,
  // portHttps: 443,
  // portLookup: {
  //   from: 3000,
  //   to: 3010,
  //   address: 'localhost'
  // },
  portLookup: false,
  statsDomain: 'stats.localhost', // set to false to disable
  statsRefreshInterval: 10000,
  servers: [
    path.resolve('./examples/serverConfig.js'),
  ]
};
