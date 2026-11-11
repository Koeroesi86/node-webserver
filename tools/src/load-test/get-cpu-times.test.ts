import { procStat } from '../test-helpers/proc-stat';
import { getCpuTimes } from './get-cpu-times';

describe('getCpuTimes', () => {
  it('adds up the time of all cores and takes the steal time out of the first line', () => {
    expect(getCpuTimes(procStat(100, 50, 800, 30))).toEqual({
      total: 980,
      steal: 30,
    });
  });

  it('does not know the times without the line, or with a line that is too short', () => {
    expect(getCpuTimes(undefined)).toBeUndefined();
    expect(getCpuTimes('cpu 1 2 3\n')).toBeUndefined();
  });
});
