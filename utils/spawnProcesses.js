const { spawn } = require('child_process');

/** https://github.com/nodejitsu/node-http-proxy */
const HttpProxy = require('http-proxy');

const { getFreePort } = require('./ports');
const { PROXY_PROTOCOLS } = require('../constants');

function spawnProcess(instance) {
  if (instance.proxyOptions && instance.childOptions) {
    const {
      childOptions: { command, args },
      proxyOptions,
      serverOptions
    } = instance;

    let childArgs = args;

    if (!proxyOptions.hostname) {
      proxyOptions.hostname = 'localhost';
    }

    if (!proxyOptions.port) {
      const port = getFreePort();
      proxyOptions.port = port;

      if (typeof childArgs === 'function') {
        childArgs = childArgs(port);
      }

      if (Array.isArray(childArgs)) {
        childArgs = childArgs.map(childArg => childArg.replace(/%PORT%/gi, port))
      }

      serverOptions.proxyTarget = `${PROXY_PROTOCOLS[serverOptions.protocol]}://${proxyOptions.hostname}:${port}`;
    }

    instance.child = spawn(command, childArgs);
    instance.proxy = new HttpProxy.createProxyServer(proxyOptions);
  }
}

module.exports = function spawnProcesses(configs) {
  return configs.forEach(spawnProcess);
};
