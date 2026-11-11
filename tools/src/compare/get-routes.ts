import { routeDurationPattern } from '../constants/load-test';
import type { K6Summary } from '../types/k6-summary';

/** the routes that have a latency in any of the summaries */
export const getRoutes = (summaries: K6Summary[]) => [
  ...new Set(
    summaries
      .flatMap(({ metrics }) => Object.keys(metrics).map((metric) => metric.match(routeDurationPattern)?.[1]))
      .filter((route): route is string => route !== undefined)
  ),
];
