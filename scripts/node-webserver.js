#!/usr/bin/env node

const { execSync } = require("child_process");
const path = require("path");
const parseArgv = require("../utils/parseArgv");

const { config } = parseArgv();

if (!config) {
  throw new Error('use with --config </path/to/config>');
}

process.env.NODE_WEBSERVER_CONFIG = config;

execSync(`node ${path.resolve(__dirname, './server.js')}`, {
  shell: true,
  stdio: 'inherit',
  env: {
    NODE_WEBSERVER_CONFIG: config,
  }
});
