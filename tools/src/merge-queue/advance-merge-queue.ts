import { REBASE_CONFLICT } from '../constants/merge-queue';
import type { MergeQueue } from '../types/merge-queue';
import { listOpenPullRequests } from './list-open-pull-requests';
import { orderMergeQueue } from './order-merge-queue';
import { rebaseConflicting } from './rebase-conflicting';

/**
 * rebases the pull request at the front of the queue when it is behind its base. The base requires up to date branches, so every merge leaves the others behind:
 * only the first one is looked at, and the ones behind it wait until it merges or its auto-merge is off. Resolves to what happened
 */
export const advanceMergeQueue = async (queue: MergeQueue): Promise<string> => {
  const { request, repository, base } = queue;
  const [next] = orderMergeQueue(await listOpenPullRequests(queue));

  if (!next) return 'No pull request has auto-merge on';

  if (next.mergeable === 'CONFLICTING') return rebaseConflicting(queue, next);

  const { behind_by: behindBy } = await request<{ behind_by: number }>(`/repos/${repository}/compare/${base}...${next.headRefOid}`);

  if (behindBy === 0) return `#${next.number} is up to date, the queue waits for it to merge`;

  return request(`/repos/${repository}/pulls/${next.number}/update-branch`, {
    method: 'PUT',
    body: JSON.stringify({ expected_head_sha: next.headRefOid, update_method: 'rebase' }),
  }).then(
    () => `Rebased #${next.number}, ${behindBy} commits behind ${base}`,
    (error) => {
      if (!REBASE_CONFLICT.test(String(error))) throw error;

      return rebaseConflicting(queue, next);
    }
  );
};
