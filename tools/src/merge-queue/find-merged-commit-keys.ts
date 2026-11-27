import type { AssociatedPullRequest, PullRequestCommit, PullRequestTarget } from '../types/merge-queue';
import { getCommitKey } from './get-commit-key';

/** the keys of the commits of the pull requests, other than the one with the number, that were merged into the base lately */
export const findMergedCommitKeys = async ({ request, repository, base }: PullRequestTarget, number: number): Promise<Set<string>> => {
  const closed = await request<AssociatedPullRequest[]>(`/repos/${repository}/pulls?state=closed&base=${base}&sort=updated&direction=desc&per_page=30`);
  const commits = await Promise.all(
    closed
      .filter((item) => item.merged_at && item.number !== number)
      .map((item) => request<PullRequestCommit[]>(`/repos/${repository}/pulls/${item.number}/commits?per_page=100`))
  );

  return new Set(commits.flat().map(getCommitKey));
};
