/** how long requests took, from the request to the close of its response, since the server started */
export type LatencySnapshot = {
  count: number;
  sumMs: number;
  maxMs: number;
  /** the upper bound of the bucket the percentile falls into, or `maxMs` above the last bucket. Zero without requests. */
  p50: number;
  p90: number;
  p99: number;
  /** the number of requests per bucket, by its upper bound in milliseconds, and `+Inf` for the slower ones. Not cumulative. */
  buckets: Record<string, number>;
};

export interface LatencyHistogram {
  record: (durationMs: number) => void;
  read: () => LatencySnapshot;
}
