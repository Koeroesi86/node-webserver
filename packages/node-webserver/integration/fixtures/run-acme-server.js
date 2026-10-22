// Starts the server of the built package with one https server that gets its certificate from the ACME server of the environment (Pebble in the pipeline).

const { resolve } = require('path');
const startServer = require('../../dist/server/start-server').default;

startServer({
  fileLogPath: false,
  logLevels: { system: true, info: true, success: true, error: true, warning: true },
  portHttp: Number(process.env.PORT_HTTP),
  portHttps: Number(process.env.PORT_HTTPS),
  statsDomain: false,
  watchServers: false,
  servers: [
    {
      hostname: process.env.ACME_HOSTNAME,
      protocol: 'https',
      redirectHttp: true,
      acme: {
        email: 'admin@example.com',
        storagePath: process.env.ACME_STORAGE,
        directory: process.env.PEBBLE_DIRECTORY,
        directoryCa: process.env.PEBBLE_CA,
      },
      type: 'worker',
      options: { root: resolve(__dirname, 'worker'), index: ['worker.js'] },
    },
  ],
})
  .then(() => console.log('The server is up.'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
