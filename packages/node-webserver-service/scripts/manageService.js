#!/usr/bin/env node

const service = require('os-service');
const path = require('path');
const fs = require('fs');
const {spawn} = require('child_process');
const parseArgv = require('../utils/parseArgv');

const {add, remove, run, configuration} = parseArgv();

const configPath = configuration || process.env.NODE_WEBSERVER_CONFIG || path.resolve(__dirname, '../configuration.example.js');

if (!fs.existsSync(configPath)) {
  throw new Error(`Configuration file does not exist: ${configPath}`);
}

const Configuration = require(configPath);

if (add) {
  service.add(Configuration.service.name, {
    displayName: Configuration.service.displayName || Configuration.service.name,
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
  service.remove(Configuration.service.name, error => {
    if (error) {
      console.trace(error);
    }
  });
} else if (run) {
  const instance = spawn(
    'node',
    [path.resolve(__dirname, '../node_modules/.bin/node-webserver'), `--config="${configPath}"`],
    {shell: true}
  );
  service.run(() => {
    instance.kill('SIGINT');
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
