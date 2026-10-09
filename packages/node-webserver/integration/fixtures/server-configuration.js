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

module.exports = {
  fileLogPath: false,
  logLevels: { system: false, info: false, success: false, error: true, warning: true },
  portHttp: Number(process.env.PORT_HTTP),
  portHttps: Number(process.env.PORT_HTTPS),
  // the ports the child servers are started on
  portLookup: { from: Number(process.env.PORT_CHILD_FROM), to: Number(process.env.PORT_CHILD_FROM) + 20, address: 'localhost' },
  statsDomain: false,
  statsRefreshInterval: 10000,
  servers: [
    worker('worker.localhost'),
    worker('compressed.localhost', { compression: { threshold: 100 } }),
    worker('websocket.localhost', { options: { root: resolve(__dirname, 'websocket'), index: ['worker.js'], limitWebSocketMessage: 200000 } }),
    lambda('lambda-ipc.localhost', 'lambda.js', 'ipc'),
    lambda('lambda-file.localhost', 'lambda-file.js', 'file'),
    {
      hostname: 'child.localhost',
      protocol: 'http',
      type: 'child',
      childOptions: { command: process.execPath, args: [resolve(__dirname, 'child.js'), '--port', '%PORT%'] },
      proxyOptions: {},
      serverOptions: { protocol: 'http' },
    },
  ],
};
