import { BASE_BRANCH, DEFAULT_GITHUB_API_URL } from '../constants/merge-queue';
import type { PullRequestTarget } from '../types/merge-queue';
import { createGithubRequest } from './create-github-request';

/** the token and the pull requests that the environment of a run names, for the scripts */
export const readPullRequestTarget = (env: NodeJS.ProcessEnv, base = BASE_BRANCH): PullRequestTarget & { token: string } => {
  const { GH_TOKEN: token, GITHUB_REPOSITORY: repository, GITHUB_API_URL: apiUrl = DEFAULT_GITHUB_API_URL } = env;

  if (!token) {
    throw new Error('GH_TOKEN is not set');
  }

  if (!repository) {
    throw new Error('GITHUB_REPOSITORY is not set');
  }

  return { token, repository, base, request: createGithubRequest(token, apiUrl) };
};
