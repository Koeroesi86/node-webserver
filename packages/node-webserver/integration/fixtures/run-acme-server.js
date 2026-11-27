// Starts the server of the built package with https servers that get their certificate from the ACME server of the environment (Pebble in the pipeline, or the one of a test).
// With FRONT_PROCESSES it runs behind a primary, and this process is the primary of the fronts, which run this script too. ACME_SERVER_FILE is one more server, in a file that is watched.

const { resolve } = require('path');
const startServer = require('../../dist/server/start-server').default;
const startCluster = require('../../dist/server/start-cluster').default;

const fronts = process.env.FRONT_PROCESSES;

const configuration = {
  ...(fronts && { frontProcesses: Number(fronts) }),
  fileLogPath: false,
  logLevels: { system: true, info: true, success: true, error: true, warning: true },
  portHttp: Number(process.env.PORT_HTTP),
  portHttps: Number(process.env.PORT_HTTPS),
  statsDomain: false,
  watchServers: Boolean(process.env.ACME_SERVER_FILE),
  servers: process.env.ACME_HOSTNAME.split(',').map((hostname) => ({
    hostname,
    protocol: 'https',
    redirectHttp: true,
    acme: {
      email: 'admin@example.com',
      storagePath: process.env.ACME_STORAGE,
      directory: process.env.ACME_DIRECTORY,
      directoryCa: process.env.ACME_CA,
    },
    type: 'worker',
    options: { root: resolve(__dirname, 'worker'), index: ['worker.js'] },
  })),
};
if (process.env.ACME_SERVER_FILE) configuration.servers.push(process.env.ACME_SERVER_FILE);

(fronts ? startCluster : startServer)(configuration)
  .then((started) => {
    if (fronts && started.role === 'front') return;
    console.log('The server is up.');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
