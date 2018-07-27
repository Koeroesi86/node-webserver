const vhost = require('vhost');
const express = require('express');
const pidusage = require("pidusage");
const { PORTS, STATS_DOMAIN } = require('../configuration');

const httpServer = express();
const httpsServer = express();

const usages = {
  overall: {},
  child: []
};

const DEFAULT_PORTS = {
  http: 80,
  https: 443
};

function addHandler({ server, proxy, hostname, proxyTarget }) {
  server.use(
    vhost(hostname, (req, res) => {
      proxy.web(req, res, {
        target: proxyTarget
      });
    })
  );
}

function getURL(protocol, hostname, port) {
  let displayedPort = port ? `:${port}` : '';

  if (DEFAULT_PORTS[protocol] === port) {
    displayedPort = '';
  }

  return `${protocol}://${hostname}${displayedPort}`;
}

function setupVirtualHost(instance) {
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
      addHandler({
        server: httpServer,
        proxy,
        hostname,
        proxyTarget
      });
      instance.serverOptions.url = getURL(protocol, hostname, PORTS.http);
      console.info(`Server started for ${instance.serverOptions.url}`);
      break;
    case 'https':
      addHandler({
        server: httpsServer,
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

function refreshStats(instances) {
  pidusage(process.pid, (err, stats) => {
    usages.overall = stats;
  });

  instances.forEach((instance, index) => {
    const { child } = instance;

    pidusage(child.pid, (err, stats) => {
      if (instance.serverOptions.url) {
        usages.child[index] = {
          url: instance.serverOptions.url,
          stats
        };
      }
    });
  });

  setTimeout(() => refreshStats(instances), 10000);
}

function statsHandler(instances) {
  if (STATS_DOMAIN) {
    refreshStats(instances);

    httpServer.set('json spaces', 4);
    httpServer.use(
      vhost(STATS_DOMAIN, (req, res) => {
        res.json(usages);
      })
    );

    console.log(`Find stats on ${getURL('http', STATS_DOMAIN, PORTS.http)}`);
  }
}

module.exports = function setupVirtualHosts(instances) {
  statsHandler(instances);

  instances.map(instance => setupVirtualHost(instance));

  httpServer.disable('x-powered-by');
  httpsServer.disable('x-powered-by');

  httpServer.listen(PORTS.http);
  httpsServer.listen(PORTS.https);
};