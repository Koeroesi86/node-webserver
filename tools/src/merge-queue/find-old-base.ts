import type { AssociatedPullRequest, PullRequestCommit, PullRequestTarget } from '../types/merge-queue';
import { findMergedCommitKeys } from './find-merged-commit-keys';
import { getCommitKey } from './get-commit-key';

/**
 * the commits at the start of a branch that belong to a merged pull request are the ones of the pull request below it, which was squash merged: the sha of the
 * last one of them, undefined when the branch does not start with such commits or has no other ones
 */
export const findOldBase = async (target: PullRequestTarget, number: number): Promise<string | undefined> => {
  const { request, repository } = target;
  const commits = await request<PullRequestCommit[]>(`/repos/${repository}/pulls/${number}/commits?per_page=100`);
  const keys = await findMergedCommitKeys(target, number);
  const merged = await Promise.all(
    commits.map(
      async (item) =>
        keys.has(getCommitKey(item)) ||
        (await request<AssociatedPullRequest[]>(`/repos/${repository}/commits/${item.sha}/pulls`)).some((pull) => pull.merged_at && pull.number !== number)
    )
  );
  const own = merged.indexOf(false);

  return own > 0 ? commits[own - 1].sha : undefined;
};
