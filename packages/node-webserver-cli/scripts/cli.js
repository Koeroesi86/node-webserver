#!/usr/bin/env node

const path = require('path');
const { startServer } = require('@koeroesi86/node-webserver');
const parseArgv = require('../utils/parseArgv');

const { config } = parseArgv();

if (!config) {
  throw new Error('use with --config </path/to/config>');
}

(async () => {
  await new Promise(r => setTimeout(r, 1));
  const configuration = require(path.resolve(config));
  await startServer(configuration);
})();
