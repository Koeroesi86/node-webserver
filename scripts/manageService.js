const service = require('os-service');
const { resolve } = require('path');
const { SERVICE_NAME } = require(process.env.NODE_WEBSERVER_CONFIG || '../configuration');
const parseArgv = require('../utils/parseArgv');

const { add, remove, run } = parseArgv();

process.chdir(__dirname);

if (add) {
  service.add(SERVICE_NAME, {
    programPath: resolve(__dirname, './server.js'),
  }, error => {
    if (error) {
      console.trace(error);
    }
  });
} else if (remove) {
  service.remove(SERVICE_NAME, error => {
    if (error) {
      console.trace(error);
    }
  });
} else if (run) {
  service.run(() => {
    service.stop(0);
  });
} else {
  console.info('\x1b[32m%s\x1b[0m', `
    Usage:
    
    yarn run service [argument]
    
    arguments:
        --add      Installs the service
        --remove   Removes the service
        --run      Attempt to run the program as a service
    `);
}
