const vHost = require('vhost');
const { PORTS } = require('../configuration');
const getURL = require('./getURL');
const setupLambda = require('./setupLambda');
const getDate = require('./getDate');

function addVHost({ server, proxy, hostname, proxyTarget }) {
  server.use(
    vHost(hostname, (req, res) => {
      proxy.web(req, res, {
        target: proxyTarget
      });
    })
  );
}

function setupVirtualHost(instance, httpApp, httpsApp) {
  const {
    serverOptions: {
      hostname,
      protocol,
      proxyTarget,
    },
    lambdaOptions,
    proxy
  } = instance;

  switch (protocol) {
    case 'http':
      instance.serverOptions.url = getURL(protocol, hostname, PORTS.http);
      if (proxyTarget) {
        addVHost({
          server: httpApp,
          proxy,
          hostname,
          proxyTarget
        });
      }
      if (lambdaOptions) {
        setupLambda({
          instance,
          server: httpApp,
          hostname,
          config: {
            lambda: lambdaOptions.lambda,
            handler: lambdaOptions.handler,
          }
        })
      }
      console.info(`[${getDate()}] Server started for ${instance.serverOptions.url}`);
      break;
    case 'https':
      instance.serverOptions.url = getURL(protocol, hostname, PORTS.https);
      if (proxyTarget) {
        addVHost({
          server: httpsApp,
          proxy,
          hostname,
          proxyTarget
        });
      }
      if (lambdaOptions) {
        setupLambda({
          instance,
          server: httpsApp,
          hostname,
          config: {
            lambda: lambdaOptions.lambda,
            handler: lambdaOptions.handler,
          }
        })
      }
      console.info(`[${getDate()}] Server started for ${instance.serverOptions.url}`);
      break;
    default:
      console.info(`[${getDate()}] Unknown protocol ${protocol} for ${hostname}`);

  }

  return instance;
}

module.exports = function setupVirtualHosts(instances, httpApp, httpsApp) {
  instances.forEach(instance => setupVirtualHost(instance, httpApp, httpsApp));
};
