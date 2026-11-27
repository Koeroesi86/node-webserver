import { listLocalBranches } from './list-local-branches';

jest.useFakeTimers();

describe('listLocalBranches', () => {
  it('lists the branches with their commit and whether a worktree has them checked out', () => {
    const git = jest.fn().mockReturnValue('master\taaa\t/repository\nfeature/one\tbbb\t\nlast\tccc');

    expect(listLocalBranches(git)).toEqual([
      { name: 'master', sha: 'aaa', isCheckedOut: true },
      { name: 'feature/one', sha: 'bbb', isCheckedOut: false },
      { name: 'last', sha: 'ccc', isCheckedOut: false },
    ]);
  });

  it('is empty for a repository without branches', () => {
    expect(listLocalBranches(jest.fn().mockReturnValue(''))).toEqual([]);
  });
});
