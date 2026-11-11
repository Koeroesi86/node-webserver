import { collectMetric } from './collect-metric';

describe('collectMetric', () => {
  it('reads the metric of every summary, undefined where it is missing', () => {
    const summaries = [{ metrics: { http_reqs: { rate: 10 } } }, { metrics: {} }, { metrics: { http_reqs: { rate: 30 } } }];

    expect(collectMetric(summaries, (metrics) => metrics.http_reqs?.rate)).toEqual([10, undefined, 30]);
  });
});
