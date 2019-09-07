const vHost = require('vhost');
const { PORTS } = require('../configuration');
const getURL = require('./getURL');
const proxyMiddleware = require('../middlewares/proxy');
const lambdaMiddleware = require('../middlewares/lambda');
const workerMiddleware = require('../middlewares/worker');
const getDate = require('./getDate');
const logger = require('./logger');

function setupVirtualHost(instance, httpApp, httpsApp) {
  const {
    serverOptions: {
      hostname,
      protocol,
    },
  } = instance;

  switch (protocol) {
    case 'http':
      if (instance.proxyOptions && instance.childOptions) {
        httpApp.use(vHost(hostname, proxyMiddleware(instance)));
      }
      if (instance.lambdaOptions) {
        httpApp.use(vHost(hostname, lambdaMiddleware(instance)));
      }
      if (instance.workerOptions) {
        httpApp.use(vHost(hostname, workerMiddleware(instance)));
      }
      instance.serverOptions.url = getURL(protocol, hostname, PORTS.http);
      logger.system(`[${getDate()}] Server started for ${instance.serverOptions.url}`);
      break;
    case 'https':
      if (instance.proxyOptions && instance.childOptions) {
        httpsApp.use(vHost(hostname, proxyMiddleware(instance)));
      }
      if (instance.lambdaOptions) {
        httpsApp.use(vHost(hostname, lambdaMiddleware(instance)));
      }
      if (instance.workerOptions) {
        httpsApp.use(vHost(hostname, workerMiddleware(instance)));
      }
      instance.serverOptions.url = getURL(protocol, hostname, PORTS.https);
      logger.system(`[${getDate()}] Server started for ${instance.serverOptions.url}`);
      break;
    default:
      logger.error(`[${getDate()}] Unknown protocol ${protocol} for ${hostname}`);

  }

  return instance;
}

module.exports = function setupVirtualHosts(instances, httpApp, httpsApp) {
  instances.forEach(instance => setupVirtualHost(instance, httpApp, httpsApp));
};
