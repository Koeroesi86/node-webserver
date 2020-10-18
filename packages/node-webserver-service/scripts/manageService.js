#!/usr/bin/env node

const service = require('os-service');
const path = require('path');
const fs = require('fs');
const parseArgv = require('../utils/parseArgv');

const {add, remove, run, configuration} = parseArgv();

const configPath = configuration || process.env.NODE_WEBSERVER_CONFIG || path.resolve(__dirname, '../configuration.example.js');

if (!fs.existsSync(configPath)) {
  throw new Error(`Configuration file does not exist: ${configPath}`);
}

const Configuration = require(configPath);

if (add) {
  service.add(Configuration.serviceName, {
    displayName: Configuration.serviceDisplayName || Configuration.serviceName,
    programPath: __filename,
    programArgs: [
      '--run',
      ...process.argv.slice(3),
    ]
  }, error => {
    if (error) {
      console.trace(error);
    }
  });
} else if (remove) {
  service.remove(Configuration.serviceName, error => {
    if (error) {
      console.trace(error);
    }
  });
} else if (run) {
  const start = require('../utils/start');
  start(configPath);
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
