import type { Judgement, TransferJudgement } from '../types/comparison';
import type { K6Summary } from '../types/k6-summary';
import { buildJudgedRow } from './build-judged-row';
import { collectMetric } from './collect-metric';
import { formatChange } from './format-change';
import { formatNumber } from './format-number';
import { median } from './median';

/**
 * The speed of the bodies that a worker reads from or writes to the client itself, by the median of the runs: the base closes the connection after every one of them, the pull request keeps it
 * for the next, so it has to be at least as fast as the base, up to the same share that the throughput may drop by. A base without the scenario answers with errors and is not judged.
 */
export const judgeTransfer = ({
  subject,
  label,
  metric,
  checks,
  baseRuns,
  headRuns,
  limits: { maxThroughputDrop, minCheckRate },
}: TransferJudgement): Judgement => {
  const speedOf = (runs: K6Summary[]) => median(collectMetric(runs, (metrics) => metrics[`${metric}{mode:keep-alive}`]?.med));
  const [base, head] = [speedOf(baseRuns), speedOf(headRuns)];
  const checkRate = median(collectMetric(baseRuns, (metrics) => metrics[checks]?.value));
  const comparable = base !== undefined && (checkRate === undefined || checkRate >= minCheckRate);
  const slower = comparable && (head === undefined || head < base * (1 - maxThroughputDrop));
  const row = buildJudgedRow({ label, base, head, comparable, failed: slower, digits: 0 });
  if (!slower) return { rows: [row], regressions: [] };

  const regression = `${subject} is ${formatChange(base, head).replace('−', '')} lower than the base (${formatNumber(base)} MB/s to ${formatNumber(head)} MB/s), the limit is ${
    maxThroughputDrop * 100
  }%.`;
  return { rows: [row], regressions: [regression] };
};
