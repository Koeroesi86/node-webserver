import { closeMergedBranches } from './close-merged-branches';
import { judgeBranch } from './judge-branch';
import { listLocalBranches } from './list-local-branches';

jest.mock('./judge-branch');
jest.mock('./list-local-branches');
jest.useFakeTimers();

describe('closeMergedBranches', () => {
  const cleanup = { request: jest.fn(), git: jest.fn(), repository: 'owner/name', base: 'master', isDeleting: true };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(listLocalBranches).mockReturnValue(['master', 'merged', 'open'].map((name) => ({ name, sha: `${name}-sha`, isCheckedOut: false })));
    jest
      .mocked(judgeBranch)
      .mockImplementation(async (_cleanup, branch) => (branch.name === 'merged' ? { branch, mergedBy: 1 } : { branch, keptBecause: 'it is open' }));
  });

  it('deletes the merged branches and says what became of each but the base', async () => {
    await expect(closeMergedBranches(cleanup)).resolves.toEqual(['deleted merged (was merged-sha), merged by #1', 'kept open: it is open']);
    expect(cleanup.git.mock.calls).toEqual([
      ['fetch', '--quiet', '--prune', 'origin'],
      ['branch', '-D', 'merged'],
    ]);
  });

  it('only lists them without deleting', async () => {
    await expect(closeMergedBranches({ ...cleanup, isDeleting: false })).resolves.toEqual([
      'would delete merged (at merged-sha), merged by #1',
      'kept open: it is open',
    ]);
    expect(cleanup.git).toHaveBeenCalledTimes(1);
  });

  it('deletes nothing when a branch cannot be judged', async () => {
    jest.mocked(judgeBranch).mockImplementation(async (_cleanup, branch) => {
      if (branch.name === 'open') throw new Error('answered 500');

      return { branch, mergedBy: 1 };
    });

    await expect(closeMergedBranches(cleanup)).rejects.toThrow('answered 500');
    expect(cleanup.git).toHaveBeenCalledTimes(1);
  });
});
