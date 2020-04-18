const vHost = require('vhost');
const { middleware: workerMiddleware } = require('@koeroesi86/node-worker-express');
const getURL = require('./getURL');
const proxyMiddleware = require('../middlewares/proxy');
const lambdaMiddleware = require('../middlewares/lambda');
const getDate = require('./getDate');
const logger = require('./logger');

function getMiddleware(instance) {
  if (instance.proxyOptions && instance.childOptions) {
    return proxyMiddleware(instance);
  }
  if (instance.lambdaOptions) {
    return lambdaMiddleware(instance);
  }
  if (instance.workerOptions) {
    return workerMiddleware({
      onStdout(data) {
        logger.info(`[${getDate()}] ${data.toString().trim()}`);
      },
      onStderr(data) {
        logger.error(`[${getDate()}] ${data.toString().trim()}`);
      },
      ...instance.workerOptions,
    });
  }
  return (req, res, next) => { next(); }
}

function setupVirtualHost(instance, httpApp, httpsApp, Configuration) {
  const { PORTS } = Configuration;
  const {
    serverOptions: {
      hostname,
      protocol,
    },
  } = instance;

  switch (protocol) {
    case 'http':
      httpApp.use(vHost(hostname, getMiddleware(instance)));
      instance.serverOptions.url = getURL(protocol, hostname, PORTS.http);
      logger.system(`[${getDate()}] Server started for ${instance.serverOptions.url}`);
      break;
    case 'https':
      httpsApp.use(vHost(hostname, getMiddleware(instance)));
      instance.serverOptions.url = getURL(protocol, hostname, PORTS.https);
      logger.system(`[${getDate()}] Server started for ${instance.serverOptions.url}`);
      break;
    default:
      logger.error(`[${getDate()}] Unknown protocol ${protocol} for ${hostname}`);

  }

  return instance;
}

module.exports = function setupVirtualHosts(instances, httpApp, httpsApp, Configuration) {
  instances.forEach(instance => setupVirtualHost(instance, httpApp, httpsApp, Configuration));
};
