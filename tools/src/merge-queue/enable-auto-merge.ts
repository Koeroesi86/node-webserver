import { AUTOMERGE_LABEL, AUTO_MERGE_REFUSALS, ENABLE_AUTO_MERGE_MUTATION } from '../constants/merge-queue';
import type { OpenPullRequest, PullRequestTarget } from '../types/merge-queue';
import { requestGraphql } from './request-graphql';

/**
 * turns squash auto-merge on and takes the label off, so that auto-merge turned off by hand stays off. A refusal that GitHub is expected to give keeps the label
 * for a later run. Resolves to what happened
 */
export const enableAutoMerge = ({ request, repository }: PullRequestTarget, { id, number }: OpenPullRequest): Promise<string> =>
  requestGraphql(request, ENABLE_AUTO_MERGE_MUTATION, { id }).then(
    async () => {
      await request(`/repos/${repository}/issues/${number}/labels/${AUTOMERGE_LABEL}`, { method: 'DELETE' });

      return `Turned on squash auto-merge for #${number} and took the label off`;
    },
    (error) => {
      if (!AUTO_MERGE_REFUSALS.test(String(error))) throw error;

      return `#${number} keeps the ${AUTOMERGE_LABEL} label, GitHub refused auto-merge: ${String(error)}`;
    }
  );
