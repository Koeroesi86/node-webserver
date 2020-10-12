const {execSync} = require('child_process');
const path = require('path');
const fs = require('fs');
const parseArgv = require('../utils/parseArgv');

const { configuration } = parseArgv();

const executable = path.resolve(__dirname, '../node_modules/.bin/node-webserver');

const configPath = configuration || process.env.NODE_WEBSERVER_CONFIG || path.resolve(__dirname, '../configuration.example.js');

if (!fs.existsSync(configPath)) {
  fs.copyFileSync(path.resolve(__dirname, '../configuration.example.js'), configPath);
}

execSync(
  `${executable} --config="${configPath}"`,
  {
    shell: true,
    stdio: 'inherit',
  }
);
