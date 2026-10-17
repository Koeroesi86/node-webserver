// The configuration of the servers the integration tests start, one of each type. The ports come from the environment, as the tests pick free ones.
const { resolve } = require('path');

const worker = (hostname, extra = {}) => ({
  hostname,
  protocol: 'http',
  type: 'worker',
  options: { root: resolve(__dirname, 'worker'), index: ['worker.js'] },
  ...extra,
});

const lambda = (hostname, file, communication) => ({
  hostname,
  protocol: 'http',
  type: 'lambda',
  lambdaOptions: { lambda: resolve(__dirname, file), handler: 'handler', communication },
});

// one file with two handlers on two routes, and a second file on a third; a path that none of them matches is not answered by a lambda at all
const lambdaRoutes = (hostname) => ({
  hostname,
  protocol: 'http',
  type: 'lambda',
  lambdaOptions: {
    routes: [
      { path: '/orders', lambda: resolve(__dirname, 'lambda-routes.js'), handler: 'list' },
      { pattern: '/orders/(?<id>[0-9]+)', lambda: resolve(__dirname, 'lambda-routes.js'), handler: 'get', limit: 1 },
      { pattern: '/other/.*', lambda: resolve(__dirname, 'lambda.js') },
    ],
  },
});

module.exports = {
  fileLogPath: false,
  // the tests of the reload read the lines of the system log
  logLevels: { system: process.env.SYSTEM_LOGS === 'true', info: false, success: false, error: true, warning: true },
  portHttp: Number(process.env.PORT_HTTP),
  portHttps: Number(process.env.PORT_HTTPS),
  http2: true,
  // the ports the child servers are started on
  portLookup: { from: Number(process.env.PORT_CHILD_FROM), to: Number(process.env.PORT_CHILD_FROM) + 20, address: 'localhost' },
  // the tests stand in for a load balancer that ended TLS, for the control path of the proxy
  trustedProxies: ['loopback'],
  ...(process.env.WATCH_SERVERS === 'false' && { watchServers: false }),
  ...(process.env.RELOAD_ON_SIGHUP === 'true' && { reloadOnSighup: true }),
  ...(process.env.SHUTDOWN_TIMEOUT && { shutdownTimeout: Number(process.env.SHUTDOWN_TIMEOUT) }),
  statsDomain: false,
  statsRefreshInterval: 10000,
  servers: [
    worker('worker.localhost'),
    worker('compressed.localhost', { compression: { threshold: 100 } }),
    // the worker reads the bodies from 1 KiB on from the client itself
    worker('upload.localhost', { options: { root: resolve(__dirname, 'worker'), index: ['worker.js'], handOffRequests: 1024 } }),
    // the worker writes the bodies from 1 KiB on to the client itself
    worker('download.localhost', { options: { root: resolve(__dirname, 'download'), index: ['worker.js'], handOffResponses: 1024 } }),
    // the metrics of the server, which count the connections that went to the workers
    worker('health.localhost', { options: { root: resolve(__dirname, '../../examples/health'), index: ['exampleWorker.js'] } }),
    worker('websocket.localhost', { options: { root: resolve(__dirname, 'websocket'), index: ['worker.js'], limitWebSocketMessage: 200000 } }),
    // the https port serves HTTP/2 too, with the same kind of servers as the http one
    worker('secure.localhost', { protocol: 'https', key: process.env.TLS_KEY, cert: process.env.TLS_CERT }),
    worker('secure-websocket.localhost', {
      protocol: 'https',
      key: process.env.TLS_KEY,
      cert: process.env.TLS_CERT,
      options: { root: resolve(__dirname, 'websocket'), index: ['worker.js'] },
    }),
    lambda('lambda-ipc.localhost', 'lambda.js', 'ipc'),
    lambda('lambda-file.localhost', 'lambda-file.js', 'file'),
    lambdaRoutes('lambda-routes.localhost'),
    {
      hostname: 'child.localhost',
      protocol: 'http',
      type: 'child',
      childOptions: { command: process.execPath, args: [resolve(__dirname, 'child.js'), '--port', '%PORT%'] },
      proxyOptions: {},
      serverOptions: { protocol: 'http' },
    },
    // the tests register an application of their own as the target, which runs on the loopback address
    { hostname: 'proxy.localhost', protocol: 'http', type: 'proxy', proxyOptions: { dynamic: { token: 'integration-token', allowPrivate: true } } },
    // nothing listens on the port the tests give it
    { hostname: 'proxy-down.localhost', protocol: 'http', type: 'proxy', proxyOptions: { target: `http://127.0.0.1:${process.env.PORT_CLOSED}` } },
    // a worker server kept warm, the test gives the file in which its worker writes down its starts
    ...(process.env.WARM_MARKER ? [worker('warm.localhost', { options: { root: resolve(__dirname, 'warm'), index: ['worker.js'], warmPaths: ['/'] } })] : []),
    // a server in a file of its own, which the test of the reload changes
    ...(process.env.RELOADED_SERVER ? [process.env.RELOADED_SERVER] : []),
  ],
};
