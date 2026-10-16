import { registerMetricsSource } from '@koeroesi86/node-worker-express';
import type { LambdaStats } from '@koeroesi86/node-lambda-invoke';

type MetricsSource = Parameters<typeof registerMetricsSource>[1];

/** Registers the stats of the workers and the lambdas of one server. Returns a function that unregisters both. */
const registerServerMetrics = (getWorkerStats: MetricsSource, lambdaStats: Pick<LambdaStats, 'getStats'>): (() => void) => {
  const unregister = [registerMetricsSource('workers', getWorkerStats), registerMetricsSource('lambdas', lambdaStats.getStats)];

  return () => unregister.forEach((remove) => remove());
};

export default registerServerMetrics;
