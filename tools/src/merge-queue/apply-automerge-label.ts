import { AUTOMERGE_LABEL } from '../constants/merge-queue';
import type { AutomergeLabelResult, PullRequestTarget } from '../types/merge-queue';
import { enableAutoMerge } from './enable-auto-merge';
import { listOpenPullRequests } from './list-open-pull-requests';
import { needsAutoMerge } from './needs-auto-merge';

/** turns auto-merge on for every pull request that the label asks it for; one that fails does not stop the others */
export const applyAutomergeLabel = async (target: PullRequestTarget): Promise<AutomergeLabelResult> => {
  const pullRequests = (await listOpenPullRequests(target)).filter(needsAutoMerge);

  if (pullRequests.length === 0) {
    return { messages: [`No pull request to ${target.base} with the ${AUTOMERGE_LABEL} label needs auto-merge`], errors: [] };
  }

  const results = await Promise.allSettled(pullRequests.map((pullRequest) => enableAutoMerge(target, pullRequest)));

  return {
    messages: results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    errors: results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
  };
};
