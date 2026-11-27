export interface GithubRequestOptions {
  method?: string;
  body?: string;
}

/** a call of the REST or GraphQL api of GitHub: the parsed answer, an error for a status that is not ok */
export type GithubRequest = <T>(path: string, options?: GithubRequestOptions) => Promise<T>;

/** git in the checkout of the repository */
export type RunGit = (...args: string[]) => Promise<void>;

/** the pull requests that are looked at: the ones of a repository (`owner/name`) to a base branch */
export interface PullRequestTarget {
  request: GithubRequest;
  repository: string;
  base: string;
}

export interface MergeQueue extends PullRequestTarget {
  git: RunGit;
}

export interface OpenPullRequest {
  number: number;
  id: string;
  headRefOid: string;
  headRefName: string;
  isDraft: boolean;
  /** from a fork */
  isCrossRepository: boolean;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  labels: { nodes: { name: string }[] };
  autoMergeRequest: { enabledAt: string } | null;
}

export type QueuedPullRequest = OpenPullRequest & { autoMergeRequest: { enabledAt: string } };

export interface PullRequestCommit {
  sha: string;
  commit: { author: { date: string }; message: string };
}

export interface AssociatedPullRequest {
  number: number;
  merged_at: string | null;
}

export interface AutomergeLabelResult {
  messages: string[];
  errors: unknown[];
}
