/** the label that asks for auto-merge, see tools/README.md#merge-queue */
export const AUTOMERGE_LABEL = 'automerge';

export const BASE_BRANCH = 'master';

/** the runner sets GITHUB_API_URL, this is for a run by hand */
export const DEFAULT_GITHUB_API_URL = 'https://api.github.com';

/** how GitHub refuses auto-merge for a pull request that is mergeable already, or that is part of a stack of GitHub: expected, so not a failure of the run */
export const AUTO_MERGE_REFUSALS = /Pull request is in (clean|unstable) status|Auto-merge is not supported for stacked pull requests/;

/** how update-branch answers when the commits cannot be rebased, which also happens while a merge of the two branches would work */
export const REBASE_CONFLICT = /answered 422: .*RebaseConflictError/;

export const OPEN_PULL_REQUESTS_QUERY = `query ($owner: String!, $name: String!, $base: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, baseRefName: $base, first: 100) {
      nodes {
        number
        id
        headRefOid
        headRefName
        isDraft
        isCrossRepository
        mergeable
        labels(first: 30) { nodes { name } }
        autoMergeRequest { enabledAt }
      }
    }
  }
}`;

export const ENABLE_AUTO_MERGE_MUTATION = `mutation ($id: ID!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH }) { pullRequest { number } }
}`;
