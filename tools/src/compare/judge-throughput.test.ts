import type { K6Summary } from '../types/k6-summary';
import { judgeThroughput } from './judge-throughput';

const summary = (rate: number, excludedRate?: number): K6Summary => ({
  metrics: { http_reqs: { rate }, ...(excludedRate === undefined ? {} : { 'http_reqs{route:cpu}': { rate: excludedRate } }) },
});

describe('judgeThroughput', () => {
  it('passes a throughput within the limit', () => {
    const { rows, regressions } = judgeThroughput([summary(4000)], [summary(3800)], [], 0.15);

    expect(regressions).toEqual([]);
    expect(rows).toEqual(['| Throughput (req/s) | 4000 (4000-4000) | 3800 (3800-3800) | −5.0% | ✅ |']);
  });

  it('reports a throughput that dropped further than the limit', () => {
    const { regressions } = judgeThroughput([summary(4000)], [summary(3000)], [], 0.15);

    expect(regressions).toEqual([expect.stringContaining('Throughput is 25.0% lower than the base, the limit is 15%')]);
  });

  it('leaves the requests of the excluded routes out and says so', () => {
    const { rows, regressions } = judgeThroughput([summary(4000, 1000)], [summary(3000, 0)], ['cpu'], 0.15);

    expect(rows[0]).toContain('Throughput (req/s, without the routes the base cannot serve) | 3000 (3000-3000) | 3000 (3000-3000)');
    expect(regressions).toEqual([]);
  });

  it('does not judge a side without a rate', () => {
    const { rows, regressions } = judgeThroughput([{ metrics: {} }], [summary(3000)], [], 0.15);

    expect(regressions).toEqual([]);
    expect(rows[0]).toContain('n/a');
  });
});
