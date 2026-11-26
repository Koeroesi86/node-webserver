// Starts the server of the built package with the configuration of the fixtures, like the script of the package does with its own.
// With FRONT_PROCESSES this process is the primary of the fronts, which run this script too.

const { findPorts } = require('../../dist/utils/ports');
const startCluster = require('../../dist/server/start-cluster').default;
const configuration = require('./server-configuration');

// what the tests ask of the server this way, as a signal cannot be sent on every platform
const commands = {
  reload: (cluster) => cluster.reload(),
  // what the signal does, handled by the server itself
  stop: () => process.emit('SIGTERM', 'SIGTERM'),
  cpu: () => process.send(process.cpuUsage()),
};

findPorts(configuration.portLookup)
  .then(() => startCluster(configuration))
  .then((cluster) => {
    if (cluster.role === 'front') return;

    process.on('message', (message) => Object.prototype.hasOwnProperty.call(commands, message) && commands[message](cluster));
    console.log('The server is up.');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
