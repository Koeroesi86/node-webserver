import type { OpenPullRequest, QueuedPullRequest } from '../types/merge-queue';

/**
 * the pull requests with auto-merge, the one it was turned on for first at the start. The checks are not looked at: a pull request that fails or conflicts
 * holds the ones behind it until its author fixes it or turns its auto-merge off
 */
export const orderMergeQueue = (pullRequests: OpenPullRequest[]): QueuedPullRequest[] =>
  pullRequests
    .filter((pullRequest): pullRequest is QueuedPullRequest => pullRequest.autoMergeRequest !== null)
    .sort((a, b) => a.autoMergeRequest.enabledAt.localeCompare(b.autoMergeRequest.enabledAt));
