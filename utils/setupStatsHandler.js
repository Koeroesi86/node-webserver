const vHost = require('vhost');
const pidUsage = require('pidusage');
const getURL = require('./getURL');
const getDate = require('./getDate');
const logger = require('./logger');

const usages = {
  overall: {},
  child: {},
};

function refreshStats(instances, refreshInterval = 10000) {
  pidUsage(process.pid).then(stats => {
    usages.overall = stats;
  }).catch(err => console.error(err));

  instances.forEach(instance => {
    const { child } = instance;

    if (child) {
      pidUsage(child.pid).then((stats) => {
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
      }).catch(err => console.error(err));
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

  setTimeout(() => refreshStats(instances, refreshInterval), refreshInterval);
}

function setupStatsHandler(instances, httpApp, Configuration) {
  const { httpPort, statsDomain, statsRefreshInterval } = Configuration;
  if (statsDomain) {
    refreshStats(instances, statsRefreshInterval);

    httpApp.set('json spaces', 4);
    httpApp.use(
      vHost(statsDomain, (req, res) => {
        res.json(usages);
      })
    );

    logger.system(`[${getDate()}] Find stats on ${getURL('http', statsDomain, httpPort)}`);
  }
}

module.exports = setupStatsHandler;
