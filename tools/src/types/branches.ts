import type { PullRequestTarget } from './merge-queue';

/** git in the checkout of the repository: what it printed, without the line break at the end. Throws when git fails */
export type ReadGit = (...args: string[]) => string;

export interface LocalBranch {
  name: string;
  sha: string;
  isCheckedOut: boolean;
}

export interface MergedPullRequest {
  number: number;
  /** the last commit of its branch */
  head: string;
  /** what merging it put on its base */
  mergeCommit: string;
}

/** `mergedBy` is the pull request that holds everything of the branch, without one `keptBecause` says why the branch stays */
export interface BranchVerdict {
  branch: LocalBranch;
  mergedBy?: number;
  keptBecause?: string;
}

export interface BranchCleanup extends PullRequestTarget {
  git: ReadGit;
  /** without it the branches are only listed */
  isDeleting: boolean;
}
