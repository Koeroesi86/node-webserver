import type { K6Summary } from '../types/k6-summary';
import { collectMetric } from '../report';
import { median } from '../utils';

export const getRouteP95 = (route: string, summaries: K6Summary[]) =>
  median(collectMetric(summaries, (metrics) => metrics[`http_req_duration{route:${route}}`]?.['p(95)']));
