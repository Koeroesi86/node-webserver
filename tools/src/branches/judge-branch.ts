import type { BranchCleanup, BranchVerdict, LocalBranch } from '../types/branches';
import { gitSucceeds } from './git-succeeds';
import { isInPullRequest } from './is-in-pull-request';
import { listMergedPullRequests } from './list-merged-pull-requests';

/** whether the branch can go: only when a pull request of its name has everything of it, and what merging that one made is on the base */
export const judgeBranch = async (cleanup: BranchCleanup, branch: LocalBranch): Promise<BranchVerdict> => {
  const { git, base } = cleanup;

  if (branch.isCheckedOut) {
    return { branch, keptBecause: 'it is checked out in a worktree' };
  }

  // a pull request stacked on another is merged into that branch, which says nothing about the base
  const onBase = (await listMergedPullRequests(cleanup, branch.name)).filter(({ mergeCommit }) =>
    gitSucceeds(git, 'merge-base', '--is-ancestor', mergeCommit, `origin/${base}`)
  );

  if (onBase.length === 0) {
    return { branch, keptBecause: `no pull request of this branch name is merged into ${base}` };
  }

  const holder = onBase.find((pullRequest) => isInPullRequest(git, branch, pullRequest));

  return holder
    ? { branch, mergedBy: holder.number }
    : { branch, keptBecause: `it has changes that are not in ${onBase.map(({ number }) => `#${number}`).join(', ')}` };
};
