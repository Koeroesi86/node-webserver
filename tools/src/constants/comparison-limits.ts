import type { Limits } from '../types/comparison';

/**
 * MAX_THROUGHPUT_DROP and MAX_P95_INCREASE are shares, MIN_P95_DIFFERENCE_MS is how many milliseconds slower a route has to be as well, as a few milliseconds are noise.
 * The load is a fixed number of users, so a build that is faster gets more requests through every route, which makes the routes compete for the cores:
 * the p95 of a route can rise while the build is better. The throughput is the figure that holds, the limits for a route are wide on purpose and only catch a route that got much slower.
 * The CPU bound run has a fixed arrival rate, so its latency does not depend on how fast the rest is, and its p95 is judged with a tighter limit.
 */
export const defaultLimits: Limits = {
  maxThroughputDrop: 0.15,
  maxP95Increase: 0.5,
  maxCpuP95Increase: 0.3,
  minP95DifferenceMs: 5,
  minCheckRate: 0.9,
};
