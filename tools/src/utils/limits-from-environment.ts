import type { Limits } from '../types/comparison';

/** the limits that are set in the environment, the others stay at their defaults */
export const limitsFromEnvironment = (environment: NodeJS.ProcessEnv = process.env): Partial<Limits> =>
  Object.fromEntries(
    Object.entries({
      maxThroughputDrop: environment.MAX_THROUGHPUT_DROP,
      maxP95Increase: environment.MAX_P95_INCREASE,
      maxCpuP95Increase: environment.MAX_CPU_P95_INCREASE,
      minP95DifferenceMs: environment.MIN_P95_DIFFERENCE_MS,
    })
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([name, value]) => [name, Number(value)])
  );
