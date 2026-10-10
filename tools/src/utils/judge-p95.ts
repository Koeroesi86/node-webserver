import type { Judgement, P95Judgement } from '../types/comparison';
import { buildJudgedRow } from './build-judged-row';
import { formatChange } from './format-change';
import { formatNumber } from './format-number';

export const judgeP95 = ({ subject, label, base, head, comparable, maxIncrease, minDifferenceMs }: P95Judgement): Judgement => {
  const slower = comparable && base !== undefined && head !== undefined && head > base * (1 + maxIncrease) && head - base > minDifferenceMs;
  const row = buildJudgedRow({ label, base, head, comparable, failed: slower, digits: 1 });
  if (!slower) return { rows: [row], regressions: [] };

  const regression = `${subject} is ${formatChange(base, head).replace('+', '')} higher than the base (${formatNumber(base, 1)} ms to ${formatNumber(
    head,
    1
  )} ms), the limit is ${maxIncrease * 100}%.`;
  return { rows: [row], regressions: [regression] };
};
