import createLatencyHistogram from './create-latency-histogram';

describe('createLatencyHistogram', () => {
  it('reports nothing before anything was recorded', () => {
    const { count, sumMs, maxMs, p50, p99, buckets } = createLatencyHistogram().read();

    expect([count, sumMs, maxMs, p50, p99]).toEqual([0, 0, 0, 0, 0]);
    expect(Object.values(buckets).every((current) => current === 0)).toBe(true);
  });

  it('counts a duration in the first bucket it fits under, the bound included', () => {
    const histogram = createLatencyHistogram();

    [0.2, 1, 1.5, 7, 10].forEach(histogram.record);

    const { buckets, count, sumMs, maxMs } = histogram.read();
    expect([buckets['1'], buckets['2'], buckets['5'], buckets['10']]).toEqual([2, 1, 0, 2]);
    expect([count, sumMs, maxMs]).toEqual([5, 19.7, 10]);
  });

  it('counts what is slower than the last bucket under +Inf, and gives the largest one seen as its percentile', () => {
    const histogram = createLatencyHistogram();

    histogram.record(45000);

    const { buckets, p50 } = histogram.read();
    expect(buckets['+Inf']).toBe(1);
    expect(p50).toBe(45000);
  });

  it('gives the upper bound of the bucket a percentile falls into', () => {
    const histogram = createLatencyHistogram();

    Array.from({ length: 98 }, () => 3).forEach(histogram.record);
    histogram.record(80);
    histogram.record(800);

    const { p50, p90, p99 } = histogram.read();
    expect([p50, p90, p99]).toEqual([5, 5, 100]);
  });

  it('does not let a caller change the counts through a snapshot', () => {
    const histogram = createLatencyHistogram();
    histogram.record(3);

    histogram.read().buckets['5'] = 100;

    expect(histogram.read().buckets['5']).toBe(1);
  });
});
