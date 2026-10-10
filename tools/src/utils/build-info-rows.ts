import type { K6Summary, Metrics } from '../types/k6-summary';
import { collectMetric } from './collect-metric';
import { formatChange } from './format-change';
import { formatNumber } from './format-number';
import { median } from './median';

const infoMetrics: [string, (metrics: Metrics) => number | undefined][] = [
  ['p95 of all requests (ms)', (metrics) => metrics.http_req_duration?.['p(95)']],
  ['WebSocket connect p95 (ms)', (metrics) => metrics.ws_connecting?.['p(95)']],
];

/** shown, not judged */
export const buildInfoRows = (baseSummaries: K6Summary[], headSummaries: K6Summary[]) =>
  infoMetrics.map(([name, read]) => {
    const [base, head] = [median(collectMetric(baseSummaries, read)), median(collectMetric(headSummaries, read))];
    return `| ${name} | ${formatNumber(base, 1)} | ${formatNumber(head, 1)} | ${formatChange(base, head)} | ➖ |`;
  });
