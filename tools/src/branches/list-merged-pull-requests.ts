import type { MergedPullRequest } from '../types/branches';
import type { PullRequestTarget } from '../types/merge-queue';

interface ClosedPullRequest {
  number: number;
  merged_at: string | null;
  merge_commit_sha: string;
  head: { sha: string };
}

/** the merged pull requests of the branch of this name in the repository, whatever their base is */
export const listMergedPullRequests = async ({ request, repository }: PullRequestTarget, branch: string): Promise<MergedPullRequest[]> => {
  const query = new URLSearchParams({ state: 'closed', head: `${repository.split('/')[0]}:${branch}`, per_page: '100' });
  const closed = await request<ClosedPullRequest[]>(`/repos/${repository}/pulls?${query}`);

  return closed.filter((pull) => pull.merged_at).map((pull) => ({ number: pull.number, head: pull.head.sha, mergeCommit: pull.merge_commit_sha }));
};
