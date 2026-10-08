// Starts the server of the built package with the configuration of the fixtures, like the script of the package does with its own.
process.env.NODE_WEBSERVER_CONFIG = require('path').resolve(__dirname, 'server-configuration.js');

const { findPorts } = require('../../dist/utils/ports');
const startServer = require('../../dist/utils/startServer').default;
const configuration = require('./server-configuration');

findPorts(configuration.portLookup)
  .then(() => startServer(configuration))
  .then(() => console.log('The server is up.'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
