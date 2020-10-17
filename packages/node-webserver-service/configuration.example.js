const path = require('path');

process.chdir(__dirname);

module.exports = {
  serviceName: 'node-webserver',
  serviceDisplayName: 'NodeJS Webserver',
  ENABLE_FILE_LOGS: true,
  FILE_LOG_PATH: path.resolve(__dirname, './.logs/'),
  LOG_LEVELS: {
    system: true,
    info: true,
    success: true,
    error: true,
    warning: true,
  },
  PORTS: {
    http: 80,
    https: 443
  },
  PORT_LOOKUP: {
    from: 3000,
    to: 3010,
    address: 'localhost'
  },
  STATS_DOMAIN: 'stats.localhost', // set to false to disable
  STATS_REFRESH_INTERVAL: 10000,
  SERVERS: [
    path.resolve('./examples/serverConfig.js'),
  ]
};
