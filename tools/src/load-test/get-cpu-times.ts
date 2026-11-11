import type { CpuTimes } from '../types/runner';

/**
 * The time of all cores since boot, and how much of it was steal: time that the hypervisor gave to other virtual machines
 * while this one wanted to run. The line is `cpu user nice system idle iowait irq softirq steal ...`
 */
export const getCpuTimes = (stat: string | undefined): CpuTimes | undefined => {
  const fields = stat
    ?.match(/^cpu\s+(.+)$/m)?.[1]
    .trim()
    .split(/\s+/)
    .map(Number);

  return fields === undefined || fields.length < 8
    ? undefined
    : {
        total: fields.slice(0, 8).reduce((sum, value) => sum + value, 0),
        steal: fields[7],
      };
};
