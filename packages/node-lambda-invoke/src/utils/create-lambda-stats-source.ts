import type { WorkerPool } from '@koeroesi86/node-worker-pool';
import type { LambdaStatsSource } from '../types';

/** the pool of a lambda as the stats of a server see it: the workers are the lambdas, a request that runs on one makes it busy */
const createLambdaStatsSource = (lambdaPath: string, pool: WorkerPool): LambdaStatsSource => ({
  lambdaPath,
  get started() {
    const { workers, starting } = pool.getCounts();
    return workers - starting;
  },
  get starting() {
    return pool.getCounts().starting;
  },
  get count() {
    return pool.getCounts().workers;
  },
  get busy() {
    // a lambda that starts holds the request that asked for it, which does not make it busy yet
    const { active, starting } = pool.getCounts();
    return Math.max(0, active - starting);
  },
  get waiting() {
    return pool.getCounts().waiting;
  },
  get abandoned() {
    return pool.getCounts().abandoned;
  },
});

export default createLambdaStatsSource;
