const vHost = require('vhost');
const pidUsage = require('pidusage');
const { PORTS, STATS_DOMAIN } = require('../configuration');
const getURL = require('./getURL');

const usages = {
  overall: {},
  child: []
};

function refreshStats(instances) {
  pidUsage(process.pid, (err, stats) => {
    usages.overall = stats;
  });

  instances.forEach((instance, index) => {
    const { child } = instance;

    pidUsage(child.pid, (err, stats) => {
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

function setupStatsHandler(instances, httpApp) {
  if (STATS_DOMAIN) {
    refreshStats(instances);

    httpApp.set('json spaces', 4);
    httpApp.use(
      vHost(STATS_DOMAIN, (req, res) => {
        res.json(usages);
      })
    );

    console.log(`Find stats on ${getURL('http', STATS_DOMAIN, PORTS.http)}`);
  }
}

module.exports = setupStatsHandler;
