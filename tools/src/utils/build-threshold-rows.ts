import type { Metrics } from '../types/k6-summary';

/** in the summary export a threshold maps to whether it was breached */
export const buildThresholdRows = (metrics: Metrics) =>
  Object.entries(metrics).flatMap(([metric, values]) =>
    Object.entries(values?.thresholds ?? {}).map(([expression, breached]) => `| \`${metric}\` | \`${expression}\` | ${breached ? '❌ failed' : '✅ passed'} |`)
  );
