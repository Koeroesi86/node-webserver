import { OPEN_PULL_REQUESTS_QUERY } from '../constants/merge-queue';
import type { OpenPullRequest, PullRequestTarget } from '../types/merge-queue';
import { requestGraphql } from './request-graphql';

export const listOpenPullRequests = async ({ request, repository, base }: PullRequestTarget): Promise<OpenPullRequest[]> => {
  const [owner, name] = repository.split('/');
  const data = await requestGraphql<{ repository: { pullRequests: { nodes: OpenPullRequest[] } } }>(request, OPEN_PULL_REQUESTS_QUERY, { owner, name, base });

  return data.repository.pullRequests.nodes;
};
