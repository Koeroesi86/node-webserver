import { defaultLimits } from '../constants/comparison-limits';
import type { ComparisonDetails, CpuSummaries, Limits } from '../types/comparison';
import type { K6Summary, Metrics } from '../types/k6-summary';
import { collectMetric } from './collect-metric';
import { formatChange } from './format-change';
import { formatNumber } from './format-number';
import { getRoutes } from './get-routes';
import { median } from './median';
import { spread } from './spread';

/**
 * Compares the repetitions of both sides by their medians.
 * A route is only judged when the base can serve it: the load test of a pull request may have routes that the base does not have.
 */
export const compareSummaries = (
  baseSummaries: K6Summary[],
  headSummaries: K6Summary[],
  limits: Partial<Limits> = {},
  { baseCpu = [], headCpu = [] }: CpuSummaries = {}
): ComparisonDetails => {
  const { maxThroughputDrop, maxP95Increase, maxCpuP95Increase, minP95DifferenceMs, minCheckRate } = { ...defaultLimits, ...limits };
  const hasCpu = baseCpu.length > 0 && headCpu.length > 0;
  const regressions: string[] = [];
  const rows: string[] = [];

  const baseRate = median(collectMetric(baseSummaries, (metrics) => metrics.http_reqs?.rate));
  const headRate = median(collectMetric(headSummaries, (metrics) => metrics.http_reqs?.rate));
  const rateSpread = (summaries: K6Summary[]) => {
    const range = spread(collectMetric(summaries, (metrics) => metrics.http_reqs?.rate));
    return range === undefined ? 'n/a' : `${formatNumber(range.min)}-${formatNumber(range.max)}`;
  };
  const droppedTooFar = baseRate !== undefined && headRate !== undefined && headRate < baseRate * (1 - maxThroughputDrop);
  if (droppedTooFar)
    regressions.push(`Throughput is ${formatChange(baseRate, headRate).replace('−', '')} lower than the base, the limit is ${maxThroughputDrop * 100}%.`);
  rows.push(
    `| Throughput (req/s) | ${formatNumber(baseRate)} (${rateSpread(baseSummaries)}) | ${formatNumber(headRate)} (${rateSpread(
      headSummaries
    )}) | ${formatChange(baseRate, headRate)} | ${droppedTooFar ? '❌' : '✅'} |`
  );

  getRoutes(headSummaries).forEach((route) => {
    const p95 = (summaries: K6Summary[]) => median(collectMetric(summaries, (metrics) => metrics[`http_req_duration{route:${route}}`]?.['p(95)']));
    const checkRate = median(collectMetric(baseSummaries, (metrics) => metrics[`checks{route:${route}}`]?.value));
    const [base, head] = [p95(baseSummaries), p95(headSummaries)];
    // a base that cannot serve the route answers with errors, which are fast
    const comparable = base !== undefined && (checkRate === undefined || checkRate >= minCheckRate);
    const slower = comparable && head !== undefined && head > base * (1 + maxP95Increase) && head - base > minP95DifferenceMs;
    if (slower)
      regressions.push(
        `The p95 of ${route} is ${formatChange(base, head).replace('+', '')} higher than the base (${formatNumber(base, 1)} ms to ${formatNumber(
          head,
          1
        )} ms), the limit is ${maxP95Increase * 100}%.`
      );
    rows.push(
      `| p95 ${route} (ms) | ${comparable ? formatNumber(base, 1) : 'n/a'} | ${formatNumber(head, 1)} | ${
        comparable ? formatChange(base, head) : 'the base cannot serve it'
      } | ${slower ? '❌' : comparable ? '✅' : '➖'} |`
    );
  });

  if (hasCpu) {
    const cpuP95 = (summaries: K6Summary[]) => median(collectMetric(summaries, (metrics) => metrics['http_req_duration{route:cpu}']?.['p(95)']));
    const cpuDropped = (summaries: K6Summary[]) => median(collectMetric(summaries, (metrics) => metrics.dropped_iterations?.count ?? 0));
    const cpuCheckRate = median(collectMetric(baseCpu, (metrics) => metrics['checks{route:cpu}']?.value));
    const [base, head] = [cpuP95(baseCpu), cpuP95(headCpu)];
    // a base without the CPU bound worker answers with fast errors
    const comparable = base !== undefined && (cpuCheckRate === undefined || cpuCheckRate >= minCheckRate);
    const slower = comparable && head !== undefined && head > base * (1 + maxCpuP95Increase) && head - base > minP95DifferenceMs;
    if (slower)
      regressions.push(
        `The p95 of the CPU bound run is ${formatChange(base, head).replace('+', '')} higher than the base (${formatNumber(base, 1)} ms to ${formatNumber(
          head,
          1
        )} ms), the limit is ${maxCpuP95Increase * 100}%.`
      );
    rows.push(
      `| p95 CPU bound (ms) | ${comparable ? formatNumber(base, 1) : 'n/a'} | ${formatNumber(head, 1)} | ${
        comparable ? formatChange(base, head) : 'the base cannot serve it'
      } | ${slower ? '❌' : comparable ? '✅' : '➖'} |`
    );

    const [baseDropped, headDropped] = [cpuDropped(baseCpu), cpuDropped(headCpu)];
    const dropsMore = comparable && (headDropped ?? 0) > (baseDropped ?? 0);
    if (dropsMore)
      regressions.push(
        `The CPU bound run dropped ${formatNumber(headDropped)} requests the server could not take on time, the base ${formatNumber(baseDropped)}.`
      );
    rows.push(
      `| CPU bound dropped requests | ${comparable ? formatNumber(baseDropped) : 'n/a'} | ${formatNumber(headDropped)} | ${
        comparable ? formatChange(baseDropped, headDropped) : 'the base cannot serve it'
      } | ${dropsMore ? '❌' : comparable ? '✅' : '➖'} |`
    );
  }

  const info = (
    [
      ['p95 of all requests (ms)', (metrics) => metrics.http_req_duration?.['p(95)']],
      ['WebSocket connect p95 (ms)', (metrics) => metrics.ws_connecting?.['p(95)']],
    ] satisfies [string, (metrics: Metrics) => number | undefined][]
  ).map(([name, read]) => {
    const [base, head] = [median(collectMetric(baseSummaries, read)), median(collectMetric(headSummaries, read))];
    return `| ${name} | ${formatNumber(base, 1)} | ${formatNumber(head, 1)} | ${formatChange(base, head)} | ➖ |`;
  });

  const markdown = [
    `## Comparison with the base ${regressions.length === 0 ? '✅ no regression' : '❌ regression'}`,
    '',
    `Medians of ${baseSummaries.length} runs of the base and ${headSummaries.length} of the pull request, alternating, on the same machine. In brackets: the range of the runs.`,
    `Judged: throughput (at most ${maxThroughputDrop * 100}% lower) and the p95 of every route (at most ${
      maxP95Increase * 100
    }% and ${minP95DifferenceMs} ms higher).${
      hasCpu
        ? ` The CPU bound run (${baseCpu.length} runs of the base, ${headCpu.length} of the pull request, at a fixed rate) is judged on its p95 (at most ${
            maxCpuP95Increase * 100
          }% and ${minP95DifferenceMs} ms higher) and on dropped requests.`
        : ''
    }`,
    '',
    '| Metric | Base | Pull request | Change | |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    ...info,
    '',
    ...(regressions.length === 0 ? [] : ['### Regressions', '', ...regressions.map((regression) => `- ${regression}`), '']),
  ].join('\n');

  return { markdown, passed: regressions.length === 0, regressions };
};
