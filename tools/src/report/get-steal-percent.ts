import type { Snapshot } from '../types/runner';

/** the share of the time between two snapshots that was steal, in percent, undefined when it is not known or no time passed */
export const getStealPercent = (before: Pick<Snapshot, 'times'>, after: Pick<Snapshot, 'times'> | undefined) => {
  if (before?.times === undefined || after?.times === undefined) return undefined;
  const total = after.times.total - before.times.total;

  return total > 0 ? ((after.times.steal - before.times.steal) / total) * 100 : undefined;
};
