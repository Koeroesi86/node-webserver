import type { Judgement, Limits } from '../types/comparison';
import type { K6Summary } from '../types/k6-summary';
import { collectMetric } from './collect-metric';
import { getRouteP95 } from './get-route-p95';
import { isComparable } from './is-comparable';
import { judgeP95 } from './judge-p95';
import { median } from './median';

/** a base without the route answers with fast errors, the bodies are what this run is about */
export const judgeBinary = (baseBinary: K6Summary[], headBinary: K6Summary[], { maxP95Increase, minP95DifferenceMs, minCheckRate }: Limits): Judgement => {
  const [base, head] = [getRouteP95('binary', baseBinary), getRouteP95('binary', headBinary)];
  const checkRate = median(collectMetric(baseBinary, (metrics) => metrics['checks{route:binary}']?.value));

  return judgeP95({
    subject: 'The p95 of the big binary responses',
    label: 'p95 binary responses (ms)',
    base,
    head,
    comparable: isComparable(base, checkRate, minCheckRate),
    maxIncrease: maxP95Increase,
    minDifferenceMs: minP95DifferenceMs,
  });
};
