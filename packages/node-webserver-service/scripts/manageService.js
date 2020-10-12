#!/usr/bin/env node

const service = require('os-service');
const path = require('path');
const fs = require('fs');
const parseArgv = require('../utils/parseArgv');

const { add, remove, run, configuration } = parseArgv();

const configPath = configuration || process.env.NODE_WEBSERVER_CONFIG || path.resolve(__dirname, '../configuration.example.js');

if (!fs.existsSync(configPath)) {
  throw new Error(`Configuration file does not exist: ${configPath}`);
}

const { SERVICE_NAME } = require(configPath);

if (add) {
  service.add(SERVICE_NAME, {
    programPath: path.resolve(__dirname, '../node_modules/.bin/node-webserver'),
    programArgs: [
      `--config="${configPath}"`
    ]
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
