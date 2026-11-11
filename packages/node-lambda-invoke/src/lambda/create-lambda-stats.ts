import type { LambdaStats, LambdaStatsSource } from '../types';

/** A registry of the lambda pools of one server, for its stats. Give it to the middlewares of that server, so that a second server in the process does not count in it. */
const createLambdaStats = (): LambdaStats => {
  const pools = new Set<LambdaStatsSource>();

  return {
    add: (pool) => {
      pools.add(pool);
    },
    remove: (pool) => {
      pools.delete(pool);
    },
    getStats: () => {
      const all = Array.from(pools);

      return {
        lambdas: all.reduce((result, pool) => result + pool.count, 0),
        /** lambdas that were asked for and have not announced themselves yet */
        starting: all.reduce((result, pool) => result + pool.starting, 0),
        busy: all.reduce((result, pool) => result + pool.busy, 0),
        /** requests that wait for a lambda to become free */
        waiting: all.reduce((result, pool) => result + pool.waiting, 0),
        /** requests whose client went away while they waited, since the process started */
        abandoned: all.reduce((result, pool) => result + pool.abandoned, 0),
        // several servers, or handlers, can use the same file
        files: all
          .filter(({ started }) => started > 0)
          .reduce<Record<string, { lambdas: number; busy: number }>>((result, pool) => {
            const { lambdas = 0, busy = 0 } = result[pool.lambdaPath] ?? {};
            return { ...result, [pool.lambdaPath]: { lambdas: lambdas + pool.started, busy: busy + pool.busy } };
          }, {}),
      };
    },
  };
};

export default createLambdaStats;
