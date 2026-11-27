import { listMergedPullRequests } from './list-merged-pull-requests';

jest.useFakeTimers();

describe('listMergedPullRequests', () => {
  it('gives the merged ones of the closed pull requests of the branch', async () => {
    const request = jest.fn().mockResolvedValue([
      { number: 1, merged_at: '2026-11-02T07:00:00Z', merge_commit_sha: 'merge', head: { sha: 'head' } },
      { number: 2, merged_at: null, merge_commit_sha: 'test merge', head: { sha: 'other' } },
    ]);

    await expect(listMergedPullRequests({ request, repository: 'owner/name', base: 'master' }, 'feature/a&b')).resolves.toEqual([
      { number: 1, head: 'head', mergeCommit: 'merge' },
    ]);
    expect(request).toHaveBeenCalledWith('/repos/owner/name/pulls?state=closed&head=owner%3Afeature%2Fa%26b&per_page=100');
  });
});
