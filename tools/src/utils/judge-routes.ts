import type { Judgement, Limits } from '../types/comparison';
import type { K6Summary } from '../types/k6-summary';
import { collectMetric } from './collect-metric';
import { getRouteP95 } from './get-route-p95';
import { isComparable } from './is-comparable';
import { judgeP95 } from './judge-p95';
import { median } from './median';

const isRouteComparable = (route: string, baseSummaries: K6Summary[], minCheckRate: number) =>
  isComparable(getRouteP95(route, baseSummaries), median(collectMetric(baseSummaries, (metrics) => metrics[`checks{route:${route}}`]?.value)), minCheckRate);

/** the routes whose requests are not work of the same kind on both sides: the fast errors of the base would count as throughput, and the work of the pull request as a loss */
export const findExcludedRoutes = (routes: string[], baseSummaries: K6Summary[], minCheckRate: number) =>
  routes.filter((route) => !isRouteComparable(route, baseSummaries, minCheckRate));

export const judgeRoutes = (routes: string[], baseSummaries: K6Summary[], headSummaries: K6Summary[], limits: Limits): Judgement[] =>
  routes.map((route) =>
    judgeP95({
      subject: `The p95 of ${route}`,
      label: `p95 ${route} (ms)`,
      base: getRouteP95(route, baseSummaries),
      head: getRouteP95(route, headSummaries),
      comparable: isRouteComparable(route, baseSummaries, limits.minCheckRate),
      maxIncrease: limits.maxP95Increase,
      minDifferenceMs: limits.minP95DifferenceMs,
    })
  );
