const { resolve } = require('path');

module.exports = {
  SERVICE_NAME: 'node-webserver', //TODO: cleanup
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
      serverOptions: {
        hostname: 'lambda.localhost',
        protocol: 'http',
      },
      lambdaOptions: {
        lambda: resolve(__dirname, './examples/exampleLambda.js'),
        handler: 'handler'
      },
    },
    {
      serverOptions: {
        hostname: 'express.localhost', //defines what host to provide the instance for
        protocol: 'http', //defines what protocol to use. http/https
        // When protocol set to 'https' both key and cert required
        // key: resolve(__dirname, './.certificates/localhost/private.pem'),
        // cert: resolve(__dirname, './.certificates/localhost/cert.pem'),
        // When proxyOptions doesn't have port, this will be generated
        // proxyTarget: 'http://localhost:8888'
      },
      childOptions: {
        command: 'node',
        args: (port) => [
          resolve(__dirname, './examples/staticServer.js'),
          `--port=${port}`,
          `--path=${resolve(__dirname, './examples/static')}`
        ]
      },
      proxyOptions: {
        target: {
          // hostname: 'localhost',
          // port: '8888'
        }
      },
    },
    {
      serverOptions: {
        hostname: 'web.localhost',
        protocol: 'http',
        // key: resolve(__dirname, './.certificates/localhost/privkey1.pem'),
        // cert: resolve(__dirname, './.certificates/localhost/cert1.pem'),
      },
      workerOptions: {
        root: resolve('examples'),
        index: [
          'exampleWorker.js'
        ]
      },
    },
  ]
};
