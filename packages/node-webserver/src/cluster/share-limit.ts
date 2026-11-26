import type { FrontShare } from '../types';

/**
 * The share of a front of a limit of the whole server, split as evenly as possible (6 over 4 fronts: 2, 2, 1, 1). 0 stays no limit,
 * and a limit never becomes 0, which would be no limit: a limit below the number of fronts gives every front 1.
 */
const shareLimit = (total: number, { index, count }: FrontShare) =>
  total <= 0 ? total : Math.max(1, Math.floor(total / count) + (index < total % count ? 1 : 0));

export default shareLimit;
