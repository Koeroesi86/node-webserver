import type { K6Summary } from '../types/k6-summary';
import { collectMetric } from './collect-metric';
import { median } from './median';

export const getRouteP95 = (route: string, summaries: K6Summary[]) =>
  median(collectMetric(summaries, (metrics) => metrics[`http_req_duration{route:${route}}`]?.['p(95)']));
