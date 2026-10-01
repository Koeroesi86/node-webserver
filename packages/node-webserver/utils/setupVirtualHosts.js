const vHost = require('vhost');
const { middleware: workerMiddleware } = require('@koeroesi86/node-worker-express');
const getURL = require('./getURL');
const proxyMiddleware = require('../middlewares/proxy');
const lambdaMiddleware = require('../middlewares/lambda');
const getDate = require('./getDate');
const logger = require('./logger');

function getMiddleware(instance) {
  if (instance.type === 'child') {
    return proxyMiddleware(instance);
  }
  if (instance.type === 'lambda') {
    return lambdaMiddleware(instance);
  }
  if (instance.type === 'worker') {
    return workerMiddleware({
      ...instance.options,
      onStdout(data) {
        logger.info(`[${getDate()}] ${data.toString().trim()}`);
        if (instance.options.onStdout) {
          instance.options.onStdout(data);
        }
      },
      onStderr(data) {
        logger.error(`[${getDate()}] ${data.toString().trim()}`);
        if (instance.options.onStderr) {
          instance.options.onStderr(data);
        }
      },
    });
  }
  return (req, res, next) => { next(); }
}

function setupVirtualHost(instance, httpApp, httpsApp, Configuration) {
  const { portHttp, portHttps } = Configuration;
  const {
    hostname,
    protocol,
  } = instance;

  switch (protocol) {
    case 'http':
      httpApp.use(vHost(hostname, getMiddleware(instance)));
      instance.url = getURL(protocol, hostname, portHttp);
      logger.system(`[${getDate()}] Server started for ${instance.url}`);
      break;
    case 'https':
      httpsApp.use(vHost(hostname, getMiddleware(instance)));
      instance.url = getURL(protocol, hostname, portHttps);
      logger.system(`[${getDate()}] Server started for ${instance.url}`);
      break;
    default:
      logger.error(`[${getDate()}] Unknown protocol ${protocol} for ${hostname}`);

  }

  return instance;
}

module.exports = function setupVirtualHosts(instances, httpApp, httpsApp, Configuration) {
  instances.forEach(instance => setupVirtualHost(instance, httpApp, httpsApp, Configuration));
};
