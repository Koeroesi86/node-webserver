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

  it('does not report one lucky run of the base when the median of the runs is within the limit', () => {
    // 104 ms against 267-337 ms and 252-293 ms, from a runner near saturation
    const { regressions, rows } = judgeCpu([cpu(337), cpu(104), cpu(267)], [cpu(304), cpu(286), cpu(287)], limits);

    expect(regressions).toEqual([]);
    expect(rows.join('\n')).toContain('p95 CPU bound, lowest of the runs (ms) | 104.0 | 286.0 | +175.0% | ❌ |');
  });

  it('reports a p95 that rose in every run', () => {
    expect(judgeCpu([cpu(100), cpu(120), cpu(110)], [cpu(200), cpu(230), cpu(210)], limits).regressions).toEqual([
      expect.stringContaining('The lowest p95 of the CPU bound runs'),
    ]);
  });

  it('reports requests that the head dropped and the base did not', () => {
    const { rows, regressions } = judgeCpu([cpu(12)], [cpu(12, { dropped: 30 })], limits);

    expect(regressions).toEqual(['The CPU bound run dropped 30 requests the server could not take on time, the base 0.']);
    expect(rows.join('\n')).toContain('CPU bound dropped requests');
  });

  it('allows a few more dropped requests than the base, as the count moves between runs of the same code', () => {
    expect(judgeCpu([cpu(12, { dropped: 83 })], [cpu(12, { dropped: 103 })], limits).regressions).toEqual([]);
    expect(judgeCpu([cpu(12)], [cpu(12, { dropped: 2 })], limits).regressions).toEqual([]);
  });

  it('reports a collapse that drops thousands of requests', () => {
    expect(judgeCpu([cpu(12, { dropped: 83 })], [cpu(12, { dropped: 2000 })], limits).regressions).toHaveLength(1);
  });

  it('does not judge a base that failed its checks', () => {
    const { regressions } = judgeCpu([cpu(1, { checks: 0.1 })], [cpu(40, { dropped: 30 })], limits);

    expect(regressions).toEqual([]);
  });
});
