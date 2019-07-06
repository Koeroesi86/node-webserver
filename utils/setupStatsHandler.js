const vHost = require('vhost');
const pidUsage = require('pidusage');
const { PORTS, STATS_DOMAIN, STATS_REFRESH_INTERVAL } = require('../configuration');
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
          };

          if (instance.lambdas) {
            const current = usages.child[instance.serverOptions.url];
            const currentLambdaStats = {};
            Promise.resolve()
              .then(() =>
                Promise.all(Object.keys(instance.lambdas).map(key => {
                  pidUsage(instance.lambdas[key].pid).then(lambdaStats => {
                    currentLambdaStats[lambdaStats.pid] = lambdaStats;
                    return Promise.resolve();
                  });
                }))
              )
              .then(() => {
                current.lambdas = currentLambdaStats;
              });
          }
        }
      });
    }

    if (instance.lambdas) {
      usages.child[instance.serverOptions.url] = {
        ...usages.child[instance.serverOptions.url],
        url: instance.serverOptions.url,
      };
      const getLambda = key => instance.lambdas[key];
      const currentLambdaStats = {};
      Promise.resolve()
        .then(() =>
          Promise.all(Object.keys(instance.lambdas).map(key => {
            const lambda = getLambda(key);
            return pidUsage(lambda.pid).then(stats => {
              currentLambdaStats[lambda.pid] = stats;
              return Promise.resolve();
            });
          }))
        )
        .then(() => {
          usages.child[instance.serverOptions.url].lambdas = currentLambdaStats
        });
    }
  });

  setTimeout(() => refreshStats(instances), STATS_REFRESH_INTERVAL || 10000);
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
