import type { Judgement, Limits } from '../types/comparison';
import type { K6Summary } from '../types/k6-summary';
import { buildJudgedRow } from './build-judged-row';
import { collectMetric } from './collect-metric';
import { formatNumber } from './format-number';
import { isComparable } from './is-comparable';
import { judgeP95 } from './judge-p95';
import { lowest } from './lowest';
import { median } from './median';

// the arrival rate is fixed, so a run can only be slowed down by the machine (other work, steal) and not sped up: the fastest run of a side is the one
// that says the most about the build, and a slower build is slower in every run
const cpuP95 = (summaries: K6Summary[]) => lowest(collectMetric(summaries, (metrics) => metrics['http_req_duration{route:cpu}']?.['p(95)']));
const cpuDropped = (summaries: K6Summary[]) => median(collectMetric(summaries, (metrics) => metrics.dropped_iterations?.count ?? 0));

export const judgeCpu = (baseCpu: K6Summary[], headCpu: K6Summary[], { maxCpuP95Increase, minP95DifferenceMs, minCheckRate }: Limits): Judgement => {
  const [base, head] = [cpuP95(baseCpu), cpuP95(headCpu)];
  const comparable = isComparable(base, median(collectMetric(baseCpu, (metrics) => metrics['checks{route:cpu}']?.value)), minCheckRate);
  const p95 = judgeP95({
    subject: 'The lowest p95 of the CPU bound runs',
    label: 'p95 CPU bound, lowest of the runs (ms)',
    base,
    head,
    comparable,
    maxIncrease: maxCpuP95Increase,
    minDifferenceMs: minP95DifferenceMs,
  });

  const [baseDropped, headDropped] = [cpuDropped(baseCpu), cpuDropped(headCpu)];
  const dropsMore = comparable && (headDropped ?? 0) > (baseDropped ?? 0);
  const row = buildJudgedRow({ label: 'CPU bound dropped requests', base: baseDropped, head: headDropped, comparable, failed: dropsMore });
  const dropped = dropsMore
    ? [`The CPU bound run dropped ${formatNumber(headDropped)} requests the server could not take on time, the base ${formatNumber(baseDropped)}.`]
    : [];

  return { rows: [...p95.rows, row], regressions: [...p95.regressions, ...dropped] };
};
