import { procStat } from '../test-helpers/proc-stat';
import { getCpuTimes } from './get-cpu-times';
import { getStealPercent } from './get-steal-percent';

describe('getStealPercent', () => {
  const at = (user: number, system: number, idle: number, steal: number) => ({
    times: getCpuTimes(procStat(user, system, idle, steal)),
  });

  it('is the share of the time between two snapshots that was steal', () => {
    expect(getStealPercent(at(100, 0, 800, 0), at(300, 0, 1500, 100))).toBeCloseTo(10, 5); // 1000 units of time passed, 100 of them were steal
  });

  it('is 0 for a machine that was not held back', () => {
    expect(getStealPercent(at(0, 0, 0, 0), at(100, 0, 100, 0))).toBe(0);
  });

  it('is not known when a snapshot has no times, or when no time passed', () => {
    expect(getStealPercent({ times: undefined }, at(1, 1, 1, 1))).toBeUndefined();
    expect(getStealPercent(at(1, 1, 1, 1), at(1, 1, 1, 1))).toBeUndefined();
  });
});
