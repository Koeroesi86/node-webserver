import type { K6Summary, Metrics } from '../types/k6-summary';

/** a metric of every repetition of one side */
export const collectMetric = (summaries: K6Summary[], read: (metrics: Metrics) => number | undefined) => summaries.map(({ metrics }) => read(metrics));
