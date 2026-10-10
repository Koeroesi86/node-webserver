import type { Judgement } from '../types/comparison';
import type { K6Summary, Metrics } from '../types/k6-summary';
import { collectMetric } from './collect-metric';
import { formatChange } from './format-change';
import { formatNumber } from './format-number';
import { median } from './median';
import { spread } from './spread';

const rateSpread = (summaries: K6Summary[], rateOf: (metrics: Metrics) => number | undefined) => {
  const range = spread(collectMetric(summaries, rateOf));
  return range === undefined ? 'n/a' : `${formatNumber(range.min)}-${formatNumber(range.max)}`;
};

/** the requests to the excluded routes are not counted, the base could not do the same work */
export const judgeThroughput = (baseSummaries: K6Summary[], headSummaries: K6Summary[], excluded: string[], maxThroughputDrop: number): Judgement => {
  const rateOf = (metrics: Metrics) =>
    metrics.http_reqs?.rate === undefined
      ? undefined
      : metrics.http_reqs.rate - excluded.reduce((sum, route) => sum + (metrics[`http_reqs{route:${route}}`]?.rate ?? 0), 0);
  const baseRate = median(collectMetric(baseSummaries, rateOf));
  const headRate = median(collectMetric(headSummaries, rateOf));
  const droppedTooFar = baseRate !== undefined && headRate !== undefined && headRate < baseRate * (1 - maxThroughputDrop);
  const hasExcludedRates = excluded.some((route) =>
    [...baseSummaries, ...headSummaries].some(({ metrics }) => metrics[`http_reqs{route:${route}}`] !== undefined)
  );
  const name = `Throughput (req/s${hasExcludedRates ? ', without the routes the base cannot serve' : ''})`;
  const row = `| ${name} | ${formatNumber(baseRate)} (${rateSpread(baseSummaries, rateOf)}) | ${formatNumber(headRate)} (${rateSpread(
    headSummaries,
    rateOf
  )}) | ${formatChange(baseRate, headRate)} | ${droppedTooFar ? '❌' : '✅'} |`;
  if (!droppedTooFar) return { rows: [row], regressions: [] };

  const regression = `Throughput is ${formatChange(baseRate, headRate).replace('−', '')} lower than the base, the limit is ${maxThroughputDrop * 100}%.`;
  return { rows: [row], regressions: [regression] };
};
