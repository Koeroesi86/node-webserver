import { LatencyOtherPaths, LatencyPathLimit } from '../constants';
import type { LatencyHistogram } from '../types';
import createLatencyHistogram from './create-latency-histogram';

/**
 * A latency histogram per path, up to `limit` paths. The ones that come after share one under `(other)`, so that a client asking for endless different paths
 * cannot grow the metrics.
 */
const createPathLatency = (limit = LatencyPathLimit) => {
  const paths = new Map<string, LatencyHistogram>();
  const other = createLatencyHistogram();

  return {
    get: (path: string) => {
      const known = paths.get(path);
      if (known !== undefined || paths.size >= limit) return known ?? other;

      const created = createLatencyHistogram();
      paths.set(path, created);
      return created;
    },
    read: () => {
      const result = Object.fromEntries(Array.from(paths.entries()).map(([path, histogram]) => [path, histogram.read()]));
      const others = other.read();

      return others.count > 0 ? { ...result, [LatencyOtherPaths]: others } : result;
    },
  };
};

export default createPathLatency;
