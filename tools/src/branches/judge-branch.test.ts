import { gitSucceeds } from './git-succeeds';
import { isInPullRequest } from './is-in-pull-request';
import { judgeBranch } from './judge-branch';
import { listMergedPullRequests } from './list-merged-pull-requests';

jest.mock('./git-succeeds');
jest.mock('./is-in-pull-request');
jest.mock('./list-merged-pull-requests');
jest.useFakeTimers();

describe('judgeBranch', () => {
  const cleanup = { request: jest.fn(), git: jest.fn(), repository: 'owner/name', base: 'master', isDeleting: false };
  const branch = { name: 'branch', sha: 'tip', isCheckedOut: false };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(listMergedPullRequests).mockResolvedValue([
      { number: 1, head: 'first', mergeCommit: 'first merge' },
      { number: 2, head: 'second', mergeCommit: 'second merge' },
    ]);
    jest.mocked(gitSucceeds).mockReturnValue(true);
  });

  it('names the pull request that has everything of the branch', async () => {
    jest.mocked(isInPullRequest).mockImplementation((_git, _branch, { number }) => number === 2);

    await expect(judgeBranch(cleanup, branch)).resolves.toEqual({ branch, mergedBy: 2 });
    expect(listMergedPullRequests).toHaveBeenCalledWith(cleanup, 'branch');
    expect(gitSucceeds).toHaveBeenCalledWith(cleanup.git, 'merge-base', '--is-ancestor', 'first merge', 'origin/master');
  });

  it('keeps a branch with changes that no merged pull request has', async () => {
    await expect(judgeBranch(cleanup, branch)).resolves.toEqual({ branch, keptBecause: 'it has changes that are not in #1, #2' });
  });

  it('keeps a branch whose pull requests did not reach the base', async () => {
    jest.mocked(gitSucceeds).mockReturnValue(false);

    await expect(judgeBranch(cleanup, branch)).resolves.toEqual({ branch, keptBecause: 'no pull request of this branch name is merged into master' });
    expect(isInPullRequest).not.toHaveBeenCalled();
  });

  it('keeps a branch that is checked out, without asking GitHub', async () => {
    const checkedOut = { ...branch, isCheckedOut: true };

    await expect(judgeBranch(cleanup, checkedOut)).resolves.toEqual({ branch: checkedOut, keptBecause: 'it is checked out in a worktree' });
    expect(listMergedPullRequests).not.toHaveBeenCalled();
  });
});
