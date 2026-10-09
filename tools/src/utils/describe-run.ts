import { routeDurationPattern } from '../constants/load-test';
import type { K6Summary } from '../types/k6-summary';
import { formatNumber } from './format-number';
import { readFile } from './read-file';

const percent = (share: number | undefined) => (share === undefined ? 'n/a' : `${(share * 100).toFixed(2)}%`);

const readSummary = (path: string): K6Summary => JSON.parse(readFile(path) ?? '');

const cpuP95Of = (path: string) => {
  try {
    return readSummary(path).metrics['http_req_duration{route:cpu}']?.['p(95)'];
  } catch {
    return undefined;
  }
};

/**
 * One line about a run of the comparison for the log, or what is wrong with its summary. A run that is much faster than the others
 * can be one that answered with fast errors, or one that a route held back less: the share of failed requests and checks, and the slowest
 * route, tell them apart. The p95 of the CPU bound run that follows it is there when it has a summary, and the steal time (Linux only) tells a run that the host held back.
 */
export const describeRun = (path: string, cpuPath?: string, stealPercent?: number) => {
  try {
    const { metrics } = readSummary(path);
    const cpuP95 = cpuPath === undefined ? undefined : cpuP95Of(cpuPath);
    const slowest = Object.entries(metrics)
      .flatMap(([name, metric]) => {
        const route = routeDurationPattern.exec(name)?.[1];
        const p95 = metric?.['p(95)'];

        return route === undefined || p95 === undefined ? [] : [{ route, p95 }];
      })
      .sort((a, b) => b.p95 - a.p95)[0];

    return [
      `${formatNumber(metrics.http_reqs?.rate)} req/s`,
      `${percent(metrics.http_req_failed?.value)} failed`,
      `checks ${percent(metrics.checks?.value)}`,
      ...(slowest === undefined ? [] : [`slowest p95 ${slowest.route} ${formatNumber(slowest.p95, 1)} ms`]),
      ...(cpuP95 === undefined ? [] : [`CPU bound p95 ${formatNumber(cpuP95, 1)} ms`]),
      ...(stealPercent === undefined ? [] : [`steal ${stealPercent.toFixed(1)}%`]),
    ].join(', ');
  } catch {
    return 'no summary';
  }
};
