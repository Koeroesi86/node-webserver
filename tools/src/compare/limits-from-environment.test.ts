import { limitsFromEnvironment } from './limits-from-environment';

describe('limitsFromEnvironment', () => {
  it('reads the limits that are set as numbers', () => {
    expect(limitsFromEnvironment({ MAX_THROUGHPUT_DROP: '0.5', MAX_P95_INCREASE: '1', MAX_CPU_P95_INCREASE: '0.2', MIN_P95_DIFFERENCE_MS: '10' })).toEqual({
      maxThroughputDrop: 0.5,
      maxP95Increase: 1,
      maxCpuP95Increase: 0.2,
      minP95DifferenceMs: 10,
    });
  });

  it('leaves out what is not set or empty, so that the default holds', () => {
    expect(limitsFromEnvironment({ MAX_THROUGHPUT_DROP: '', MAX_P95_INCREASE: '2' })).toEqual({ maxP95Increase: 2 });
    expect(limitsFromEnvironment({})).toEqual({});
  });
});
