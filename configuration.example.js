const { resolve } = require('path');

module.exports = {
  fileLogPath: resolve(__dirname, './logs/'),
  logLevels: {
    system: true,
    info: true,
    success: true,
    error: true,
    warning: true,
  },
  portHttp: 80,
  portHttps: 443,
  portLookup: {
    from: 3000,
    to: 3010,
    address: 'localhost'
  },
  statsDomain: 'stats.localhost', // set to false to disable
  statsRefreshInterval: 10000,
  servers: [
    {
      hostname: 'web.localhost',
      protocol: 'http',
      // key: resolve(__dirname, './.certificates/localhost/privkey1.pem'),
      // cert: resolve(__dirname, './.certificates/localhost/cert1.pem'),
      type: 'worker', // 'child'|'lambda'|'worker'
      options: {
        root: resolve('examples'),
        index: [
          'exampleWorker.js'
        ]
      },
    },
  ]
};
