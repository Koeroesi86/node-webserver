import type { LocalBranch, MergedPullRequest, ReadGit } from '../types/branches';
import { gitSucceeds } from './git-succeeds';

/**
 * whether the pull request has everything of the branch: each commit of the branch that its head does not reach has an equal change there, as when the branch was
 * rebased on GitHub. A merge commit has no change to compare, so it counts as missing
 */
export const isInPullRequest = (git: ReadGit, { sha }: LocalBranch, { number, head }: MergedPullRequest): boolean => {
  if (!gitSucceeds(git, 'cat-file', '-e', `${head}^{commit}`)) {
    git('fetch', '--quiet', 'origin', `refs/pull/${number}/head`);
  }

  return (
    git('rev-list', '--merges', `${head}..${sha}`) === '' &&
    git('cherry', head, sha)
      .split('\n')
      .every((line) => !line.startsWith('+'))
  );
};
