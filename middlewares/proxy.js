const { spawn } = require('child_process');

/** https://github.com/nodejitsu/node-http-proxy */
const HttpProxy = require('http-proxy');

const { getFreePort } = require('../utils/ports');
const { PROXY_PROTOCOLS } = require('../constants');

const proxyMiddleware = (instance) => {
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

  return (req, res) => {
    instance.proxy.web(req, res, { target: serverOptions.proxyTarget  });
  }
};

module.exports = proxyMiddleware;
