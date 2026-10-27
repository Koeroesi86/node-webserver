import type { Judgement, Limits } from '../types/comparison';
import type { K6Summary } from '../types/k6-summary';
import { buildJudgedRow } from './build-judged-row';
import { collectMetric } from './collect-metric';
import { formatNumber } from './format-number';
import { isComparable } from './is-comparable';
import { judgeP95 } from './judge-p95';
import { lowest } from './lowest';
import { median } from './median';

// requests (of about 3000 in a run) that more may be dropped than by the base: at the edge of what the cores take the count moves by tens between runs of the same code
const minDroppedDifference = 10;

const cpuP95Values = (summaries: K6Summary[]) => collectMetric(summaries, (metrics) => metrics['http_req_duration{route:cpu}']?.['p(95)']);
const cpuDropped = (summaries: K6Summary[]) => median(collectMetric(summaries, (metrics) => metrics.dropped_iterations?.count ?? 0));

export const judgeCpu = (baseCpu: K6Summary[], headCpu: K6Summary[], { maxCpuP95Increase, minP95DifferenceMs, minCheckRate }: Limits): Judgement => {
  const comparable = isComparable(
    lowest(cpuP95Values(baseCpu)),
    median(collectMetric(baseCpu, (metrics) => metrics['checks{route:cpu}']?.value)),
    minCheckRate
  );
  const judgeP95Of = (pick: (values: (number | undefined)[]) => number | undefined, subject: string, label: string) =>
    judgeP95({
      subject,
      label,
      base: pick(cpuP95Values(baseCpu)),
      head: pick(cpuP95Values(headCpu)),
      comparable,
      maxIncrease: maxCpuP95Increase,
      minDifferenceMs: minP95DifferenceMs,
    });
  // the arrival rate is fixed, so a run can only be slowed down by the machine (other work, steal) and not sped up: a slower build is slower in every run.
  // The lowest run of a side alone is not enough, as one lucky run of the base made unchanged code look twice as slow (104 ms against 250-290 ms in all of its runs
  // on a runner that is near saturation): the median of the runs has to be beyond the limit as well. The median alone once came out 43 against 73 ms with the same server.
  const fastest = judgeP95Of(lowest, 'The lowest p95 of the CPU bound runs', 'p95 CPU bound, lowest of the runs (ms)');
  const typical = judgeP95Of(median, 'The median p95 of the CPU bound runs', 'p95 CPU bound, median of the runs (ms)');
  const regressions = typical.regressions.length === 0 ? [] : fastest.regressions;

  const [baseDropped, headDropped] = [cpuDropped(baseCpu), cpuDropped(headCpu)];
  const dropsMore =
    comparable && (headDropped ?? 0) > (baseDropped ?? 0) * (1 + maxCpuP95Increase) && (headDropped ?? 0) - (baseDropped ?? 0) >= minDroppedDifference;
  const row = buildJudgedRow({ label: 'CPU bound dropped requests', base: baseDropped, head: headDropped, comparable, failed: dropsMore });
  const dropped = dropsMore
    ? [`The CPU bound run dropped ${formatNumber(headDropped)} requests the server could not take on time, the base ${formatNumber(baseDropped)}.`]
    : [];

  return { rows: [...fastest.rows, ...typical.rows, row], regressions: [...regressions, ...dropped] };
};
