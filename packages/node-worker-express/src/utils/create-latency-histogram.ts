import { LatencyBucketsMs } from '../constants';
import type { LatencyHistogram, LatencySnapshot } from '../types';

/**
 * Counts durations into the fixed buckets of `LatencyBucketsMs` and one above them, since it was created.
 * Recording only adds to numbers that exist already, so it costs no memory per request.
 */
const createLatencyHistogram = (): LatencyHistogram => {
  const counts = new Array<number>(LatencyBucketsMs.length + 1).fill(0);
  let count = 0;
  let sumMs = 0;
  let maxMs = 0;

  /** the upper bound of the bucket the share of the durations falls into, the largest one seen above the last bucket */
  const percentile = (share: number) => {
    const rank = Math.ceil(count * share);
    let seen = 0;
    const index = counts.findIndex((current) => (seen += current) >= rank);

    return index < LatencyBucketsMs.length ? LatencyBucketsMs[index] : maxMs;
  };

  return {
    record: (durationMs: number) => {
      const index = LatencyBucketsMs.findIndex((bound) => durationMs <= bound);
      counts[index === -1 ? LatencyBucketsMs.length : index] += 1;
      count += 1;
      sumMs += durationMs;
      if (durationMs > maxMs) maxMs = durationMs;
    },
    read: (): LatencySnapshot => ({
      count,
      sumMs,
      maxMs,
      ...(count === 0 ? { p50: 0, p90: 0, p99: 0 } : { p50: percentile(0.5), p90: percentile(0.9), p99: percentile(0.99) }),
      buckets: Object.fromEntries(counts.map((current, index) => [index < LatencyBucketsMs.length ? String(LatencyBucketsMs[index]) : '+Inf', current])),
    }),
  };
};

export default createLatencyHistogram;
