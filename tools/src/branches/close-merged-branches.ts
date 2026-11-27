import type { BranchCleanup, BranchVerdict } from '../types/branches';
import { judgeBranch } from './judge-branch';
import { listLocalBranches } from './list-local-branches';

const closeBranch = ({ git, isDeleting }: BranchCleanup, { branch: { name, sha }, mergedBy, keptBecause }: BranchVerdict): string => {
  if (!mergedBy) {
    return `kept ${name}: ${keptBecause}`;
  }

  if (!isDeleting) {
    return `would delete ${name} (at ${sha}), merged by #${mergedBy}`;
  }

  // forced, as git does not see that a squash or rebase merged the branch
  git('branch', '-D', name);

  return `deleted ${name} (was ${sha}), merged by #${mergedBy}`;
};

/** deletes, or only lists, the local branches other than the base that are merged. A line for every branch */
export const closeMergedBranches = async (cleanup: BranchCleanup): Promise<string[]> => {
  cleanup.git('fetch', '--quiet', '--prune', 'origin');
  const branches = listLocalBranches(cleanup.git).filter(({ name }) => name !== cleanup.base);
  // every branch is judged before the first one is deleted, so that a failing request leaves all of them
  const verdicts = await Promise.all(branches.map((branch) => judgeBranch(cleanup, branch)));

  return verdicts.map((verdict) => closeBranch(cleanup, verdict));
};
