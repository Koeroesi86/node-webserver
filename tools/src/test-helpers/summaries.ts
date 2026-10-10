import type { K6Summary } from '../types/k6-summary';

export interface SummaryOptions {
  rate?: number;
  routes?: Record<string, number>;
  checks?: Record<string, number>;
  /** requests per second of a route, which are part of the rate */
  routeRates?: Record<string, number>;
  connecting?: number;
  overall?: number;
}

export interface CpuSummaryOptions {
  p95?: number;
  dropped?: number;
  checks?: number;
}

/** a summary with the throughput, the p95 per route and whether the checks of the routes passed */
export const summary = ({
  rate = 4000,
  routes = { worker: 6, static: 7 },
  checks = {},
  routeRates = {},
  connecting = 100,
  overall = 8,
}: SummaryOptions = {}): K6Summary => ({
  metrics: {
    http_reqs: { rate },
    http_req_duration: { 'p(95)': overall },
    ws_connecting: { 'p(95)': connecting },
    ...Object.fromEntries(Object.entries(routes).map(([route, p95]) => [`http_req_duration{route:${route}}`, { 'p(95)': p95 }])),
    ...Object.fromEntries(Object.entries(routeRates).map(([route, routeRate]) => [`http_reqs{route:${route}}`, { rate: routeRate }])),
    ...Object.fromEntries(Object.entries(checks).map(([route, value]) => [`checks{route:${route}}`, { value }])),
  },
});

/** a summary of cpu.ts: the p95 of the route, the requests that were dropped and whether the checks passed */
export const cpuSummary = ({ p95 = 12, dropped, checks = 1 }: CpuSummaryOptions = {}): K6Summary => ({
  metrics: {
    'http_req_duration{route:cpu}': { 'p(95)': p95 },
    'checks{route:cpu}': { value: checks },
    ...(dropped === undefined ? {} : { dropped_iterations: { count: dropped } }),
  },
});
/** a summary of binary.ts: the p95 of the route and whether the checks passed */
export const binarySummary = ({ p95 = 20, checks = 1 }: { p95?: number; checks?: number } = {}): K6Summary => ({
  metrics: {
    'http_req_duration{route:binary}': { 'p(95)': p95 },
    'checks{route:binary}': { value: checks },
  },
});
export const binaryRuns = (count: number, options?: { p95?: number; checks?: number }) => Array.from({ length: count }, () => binarySummary(options));
export const cpuRuns = (count: number, options?: CpuSummaryOptions) => Array.from({ length: count }, () => cpuSummary(options));

export const runs = (...options: SummaryOptions[]) => options.map((option) => summary(option));
export const same = (count = 3, options: SummaryOptions = {}) => Array.from({ length: count }, () => summary(options));
