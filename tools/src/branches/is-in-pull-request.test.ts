import { isInPullRequest } from './is-in-pull-request';

jest.useFakeTimers();

describe('isInPullRequest', () => {
  const branch = { name: 'branch', sha: 'tip', isCheckedOut: false };
  const pullRequest = { number: 3, head: 'head', mergeCommit: 'merge' };
  const createGit = (answers: Record<string, string> = {}) => jest.fn((command: string, ..._args: string[]) => answers[command] ?? '');

  it('is true when the head reaches the branch', () => {
    const git = createGit();

    expect(isInPullRequest(git, branch, pullRequest)).toBe(true);
    expect(git).toHaveBeenCalledWith('cherry', 'head', 'tip');
    expect(git).not.toHaveBeenCalledWith('fetch', expect.anything(), expect.anything(), expect.anything());
  });

  it('is true when the head has an equal change for every other commit', () => {
    expect(isInPullRequest(createGit({ cherry: '- aaa\n- bbb' }), branch, pullRequest)).toBe(true);
  });

  it('is false with a commit that the head has no equal change for', () => {
    expect(isInPullRequest(createGit({ cherry: '- aaa\n+ bbb' }), branch, pullRequest)).toBe(false);
  });

  it('is false with a merge commit that the head does not reach', () => {
    expect(isInPullRequest(createGit({ 'rev-list': 'aaa' }), branch, pullRequest)).toBe(false);
  });

  it('fetches the head of the pull request when the repository does not have it', () => {
    const git = createGit();
    git.mockImplementationOnce(() => {
      throw new Error('unknown commit');
    });

    isInPullRequest(git, branch, pullRequest);

    expect(git).toHaveBeenCalledWith('fetch', '--quiet', 'origin', 'refs/pull/3/head');
  });
});
