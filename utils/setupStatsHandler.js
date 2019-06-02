const vHost = require('vhost');
const pidUsage = require('pidusage');
const { PORTS, STATS_DOMAIN } = require('../configuration');
const getURL = require('./getURL');
const getDate = require('./getDate');
const logger = require('./logger');

const usages = {
  overall: {},
  child: {},
};

function refreshStats(instances) {
  pidUsage(process.pid, (err, stats) => {
    usages.overall = stats;
  });

  instances.forEach(instance => {
    const { child } = instance;

    if (child) {
      pidUsage(child.pid, (err, stats) => {
        if (instance.serverOptions.url) {
          usages.child[instance.serverOptions.url] = {
            url: instance.serverOptions.url,
            stats,
            ...(instance.lambdas && { lambdas: {} }),
          };

          if (instance.lambdas) {
            const current = usages.child[instance.serverOptions.url];
            Object.keys(instance.lambdas).forEach(key => {
              pidUsage(instance.lambdas[key].pid, (lambdaStatsErr, lambdaStats) => {
                current.lambdas[lambdaStats.pid] = lambdaStats;
              });
            });
          }
        }
      });
    }

    if (instance.lambdas) {
      usages.child[instance.serverOptions.url] = {
        url: instance.serverOptions.url,
        lambdas: {},
      };
      const current = usages.child[instance.serverOptions.url];
      Object.keys(instance.lambdas).forEach(key => {
        const lambda = instance.lambdas[key];
        pidUsage(lambda.pid, (error, stats) => {
          current.lambdas[lambda.pid] = stats;
        });
      });
    }
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

    logger.system(`[${getDate()}] Find stats on ${getURL('http', STATS_DOMAIN, PORTS.http)}`);
  }
}

module.exports = setupStatsHandler;
