const vHost = require('vhost');
const { PORTS } = require('../configuration');
const getURL = require('./getURL');

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
      proxyTarget
    },
    proxy
  } = instance;

  switch (protocol) {
    case 'http':
      addVHost({
        server: httpApp,
        proxy,
        hostname,
        proxyTarget
      });
      instance.serverOptions.url = getURL(protocol, hostname, PORTS.http);
      console.info(`Server started for ${instance.serverOptions.url}`);
      break;
    case 'https':
      addVHost({
        server: httpsApp,
        proxy,
        hostname,
        proxyTarget
      });
      instance.serverOptions.url = getURL(protocol, hostname, PORTS.https);
      console.info(`Server started for ${instance.serverOptions.url}`);
      break;
    default:
      console.info(`unknown protocol ${protocol} for ${hostname}`);

  }

  return instance;
}

module.exports = function setupVirtualHosts(instances, httpApp, httpsApp) {
  instances.forEach(instance => setupVirtualHost(instance, httpApp, httpsApp));
};
