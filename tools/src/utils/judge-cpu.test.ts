import type { Limits } from '../types/comparison';
import type { K6Summary } from '../types/k6-summary';
import { judgeCpu } from './judge-cpu';

const limits: Limits = { maxThroughputDrop: 0.15, maxP95Increase: 0.5, maxCpuP95Increase: 0.5, minP95DifferenceMs: 5, minCheckRate: 0.99 };

const cpu = (p95: number, { dropped = 0, checks }: { dropped?: number; checks?: number } = {}): K6Summary => ({
  metrics: {
    'http_req_duration{route:cpu}': { 'p(95)': p95 },
    dropped_iterations: { count: dropped },
    ...(checks === undefined ? {} : { 'checks{route:cpu}': { value: checks } }),
  },
});

describe('judgeCpu', () => {
  it('passes runs that are the same', () => {
    expect(judgeCpu([cpu(12)], [cpu(12)], limits).regressions).toEqual([]);
  });

  it('takes the lowest p95 of the runs of a side', () => {
    const { regressions } = judgeCpu([cpu(12), cpu(40)], [cpu(13), cpu(90)], limits);

    expect(regressions).toEqual([]);
  });

  it('reports a p95 that rose beyond the limit', () => {
    expect(judgeCpu([cpu(12)], [cpu(40)], limits).regressions).toEqual([expect.stringContaining('The lowest p95 of the CPU bound runs')]);
  });

  it('reports requests that the head dropped and the base did not', () => {
    const { rows, regressions } = judgeCpu([cpu(12)], [cpu(12, { dropped: 30 })], limits);

    expect(regressions).toEqual(['The CPU bound run dropped 30 requests the server could not take on time, the base 0.']);
    expect(rows.join('\n')).toContain('CPU bound dropped requests');
  });

  it('does not judge a base that failed its checks', () => {
    const { regressions } = judgeCpu([cpu(1, { checks: 0.1 })], [cpu(40, { dropped: 30 })], limits);

    expect(regressions).toEqual([]);
  });
});
