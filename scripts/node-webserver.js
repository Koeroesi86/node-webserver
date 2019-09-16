const { execSync } = require("child_process");
const minimist = require("minimist");
const path = require("path");

const { config } = minimist(process.argv.slice(2));

if (!config) {
  throw new Error('use with --config </path/to/config>');
}

process.env.NODE_WEBSERVER_CONFIG = config;

execSync(`node ${path.resolve(__dirname, './server.js')}`, {
  shell: true,
  env: {
    NODE_WEBSERVER_CONFIG: config,
  }
});
