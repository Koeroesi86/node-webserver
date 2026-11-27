import type { Express } from 'express';
import vHost from 'vhost';
import pidUsage from 'pidusage';
import { getURL } from '../request';
import { getDate } from '../utils';
import type { Configuration, Logger, ServerRuntime, ServerState } from '../types';

type Lambdas = NonNullable<ServerRuntime['lambdas']>;

interface ChildUsage {
  url: string;
  stats?: pidUsage.Status;
  lambdas?: Record<number, pidUsage.Status>;
}

interface Usages {
  overall: Partial<pidUsage.Status>;
  child: Record<string, ChildUsage>;
  /** with several front processes: the one that answers, whose numbers `overall` and `child` are */
  front?: number;
  /** and the usage of every one of them, by their number */
  fronts?: Record<string, pidUsage.Status>;
}

/** the front that answers, and the processes of all of them */
interface Fronts {
  front: number;
  list: () => Record<string, number>;
}

const usages: Usages = {
  overall: {},
  child: {},
};

const getLambdaStats = (lambdas: Lambdas) =>
  Promise.all(Object.values(lambdas).map(({ pid }) => pidUsage(pid))).then((stats) =>
    Object.fromEntries(stats.map((lambdaStats) => [lambdaStats.pid, lambdaStats]))
  );

function refreshInstanceStats({ instance, runtime }: ServerState) {
  const { child, appPid, lambdas } = runtime;
  const url = instance.serverOptions?.url;
  // started by this process, or in a front by the primary
  const pid = child?.pid ?? appPid?.();

  if (pid && url) {
    pidUsage(pid)
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

function refreshFrontStats({ front, list }: Fronts) {
  const processes = Object.entries(list());
  if (!processes.length) return;

  // one that ended meanwhile is left out
  Promise.allSettled(processes.map(async ([number, pid]) => [number, await pidUsage(pid)] as const)).then((results) => {
    usages.front = front;
    usages.fronts = Object.fromEntries(results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])));
  });
}

/** the servers are asked for every time, as they change when the configuration is loaded again */
function refreshStats(getInstances: () => ServerState[], refreshInterval = 10000, fronts?: Fronts) {
  pidUsage(process.pid)
    .then((stats) => {
      usages.overall = stats;
    })
    .catch((err) => console.error(err));

  getInstances().forEach(refreshInstanceStats);
  if (fronts) refreshFrontStats(fronts);

  setTimeout(() => refreshStats(getInstances, refreshInterval, fronts), refreshInterval);
}

function setupStatsHandler(getInstances: () => ServerState[], httpApp: Express, Configuration: Partial<Configuration>, logger: Logger, fronts?: Fronts) {
  const { portHttp, statsDomain, statsRefreshInterval } = Configuration;
  if (statsDomain) {
    refreshStats(getInstances, statsRefreshInterval, fronts);

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
