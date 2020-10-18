const path = require('path');
const fs = require('fs');
const parseArgv = require('../utils/parseArgv');
const start = require('../utils/start');

const { configuration } = parseArgv();

const configPath = configuration || process.env.NODE_WEBSERVER_CONFIG || path.resolve(__dirname, '../configuration.example.js');

if (!fs.existsSync(configPath)) {
  fs.copyFileSync(path.resolve(__dirname, '../configuration.example.js'), configPath);
}

start(configPath);
