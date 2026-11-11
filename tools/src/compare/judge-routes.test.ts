import type { Limits } from '../types/comparison';
import type { K6Summary } from '../types/k6-summary';
import { findExcludedRoutes, judgeRoutes } from './judge-routes';

const limits: Limits = { maxThroughputDrop: 0.15, maxP95Increase: 0.5, maxCpuP95Increase: 0.5, minP95DifferenceMs: 5, minCheckRate: 0.99 };

const route = (name: string, p95: number, checks?: number): K6Summary => ({
  metrics: {
    [`http_req_duration{route:${name}}`]: { 'p(95)': p95 },
    ...(checks === undefined ? {} : { [`checks{route:${name}}`]: { value: checks } }),
  },
});

describe('findExcludedRoutes', () => {
  it('lists the routes that the base could not serve for real', () => {
    const base = [{ metrics: { ...route('worker', 6).metrics, ...route('lambda', 1, 0.2).metrics } }];

    expect(findExcludedRoutes(['worker', 'lambda', 'missing'], base, 0.99)).toEqual(['lambda', 'missing']);
  });
});

describe('judgeRoutes', () => {
  it('judges every route on its own', () => {
    const base = [{ metrics: { ...route('worker', 10).metrics, ...route('static', 10).metrics } }];
    const head = [{ metrics: { ...route('worker', 10).metrics, ...route('static', 50).metrics } }];

    const [worker, staticRoute] = judgeRoutes(['worker', 'static'], base, head, limits);

    expect(worker.regressions).toEqual([]);
    expect(staticRoute.regressions).toEqual([expect.stringContaining('The p95 of static')]);
  });

  it('does not judge a route that the base cannot serve', () => {
    const [judged] = judgeRoutes(['lambda'], [route('lambda', 1, 0.2)], [route('lambda', 80)], limits);

    expect(judged.regressions).toEqual([]);
    expect(judged.rows[0]).toContain('the base cannot serve it');
  });
});
