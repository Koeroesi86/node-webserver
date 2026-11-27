import type { GithubRequest, GithubRequestOptions } from '../types/merge-queue';

/** requests to the api of GitHub with the token */
export const createGithubRequest =
  (token: string, apiUrl: string): GithubRequest =>
  async <T>(path: string, options?: GithubRequestOptions): Promise<T> => {
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`${options?.method ?? 'GET'} ${path} answered ${response.status}: ${await response.text()}`);
    }

    return JSON.parse(await response.text());
  };
