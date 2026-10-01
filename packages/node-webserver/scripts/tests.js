const { resolve } = require('path');
const fs = require('fs');
const jest = require('jest');

process.chdir(__dirname);

let argv = process.argv.slice(2);
const configurationPath = process.env.NODE_WEBSERVER_CONFIG || resolve(__dirname, '../configuration.js');
const configurationExamplePath = resolve(__dirname, '../configuration.example.js');

// create config for build
if (!fs.existsSync(configurationPath)) {
  // copy example for now
  fs.copyFileSync(configurationExamplePath, configurationPath);
}

//Unless someone else came by
if (!argv.includes('--config')) {
  argv.push('--config', resolve(__dirname, '../jest.config.js'));
}

jest.run(argv);
