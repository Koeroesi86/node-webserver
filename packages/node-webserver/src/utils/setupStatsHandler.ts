import type { Express } from 'express';
import vHost from 'vhost';
import pidUsage from 'pidusage';
import getURL from './getURL';
import getDate from './getDate';
import logger from './logger';
import type { Configuration, ServerInstance } from '../types';

type Lambdas = NonNullable<ServerInstance['lambdas']>;

interface ChildUsage {
  url: string;
  stats?: pidUsage.Status;
  lambdas?: Record<number, pidUsage.Status>;
}

interface Usages {
  overall: Partial<pidUsage.Status>;
  child: Record<string, ChildUsage>;
}

const usages: Usages = {
  overall: {},
  child: {},
};

const getLambdaStats = (lambdas: Lambdas) =>
  Promise.all(Object.values(lambdas).map(({ pid }) => pidUsage(pid))).then((stats) =>
    Object.fromEntries(stats.map((lambdaStats) => [lambdaStats.pid, lambdaStats]))
  );

function refreshInstanceStats(instance: ServerInstance) {
  const { child, lambdas } = instance;
  const url = instance.serverOptions?.url;

  if (child?.pid && url) {
    pidUsage(child.pid)
      .then((stats) => {
        usages.child[url] = { url, stats };

        if (lambdas) {
          getLambdaStats(lambdas).then((lambdaStats) => {
            usages.child[url].lambdas = lambdaStats;
          });
        }
      })
      .catch((err) => console.error(err));
  }

  if (lambdas && url) {
    usages.child[url] = { ...usages.child[url], url };
    getLambdaStats(lambdas).then((lambdaStats) => {
      usages.child[url].lambdas = lambdaStats;
    });
  }
}

function refreshStats(instances: ServerInstance[], refreshInterval = 10000) {
  pidUsage(process.pid)
    .then((stats) => {
      usages.overall = stats;
    })
    .catch((err) => console.error(err));

  instances.forEach(refreshInstanceStats);

  setTimeout(() => refreshStats(instances, refreshInterval), refreshInterval);
}

function setupStatsHandler(instances: ServerInstance[], httpApp: Express, Configuration: Partial<Configuration>) {
  const { portHttp, statsDomain, statsRefreshInterval } = Configuration;
  if (statsDomain) {
    refreshStats(instances, statsRefreshInterval);

    httpApp.set('json spaces', 4);
    httpApp.use(
      vHost(statsDomain, (req, res) => {
        res.json(usages);
      })
    );

    logger.system(`[${getDate()}] Find stats on ${getURL('http', statsDomain, portHttp)}`);
  }
}

export default setupStatsHandler;
