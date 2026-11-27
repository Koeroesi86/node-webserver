import type { MergeQueue, OpenPullRequest } from '../types/merge-queue';
import { findOldBase } from './find-old-base';
import { replayCommits } from './replay-commits';

/** replays the own commits of a pull request that conflicts because the one below it was squash merged; any other conflict is left to its author. Resolves to what happened */
export const rebaseConflicting = async (queue: MergeQueue, pullRequest: OpenPullRequest): Promise<string> => {
  const { number, isCrossRepository } = pullRequest;
  // the branch of a fork is not one to push to
  const oldBase = isCrossRepository ? undefined : await findOldBase(queue, number);

  if (!oldBase) return `#${number} has a conflict, the queue waits for its author`;

  if (!(await replayCommits(queue.git, pullRequest, oldBase, queue.base)))
    return `#${number} has a conflict of its own commits, the queue waits for its author`;

  return `Replayed the commits of #${number} after ${oldBase} onto ${queue.base}`;
};
