import { startFakeGithub } from '../test-helpers/fake-github';
import { createGithubRequest } from './create-github-request';
import { findMergedCommitKeys } from './find-merged-commit-keys';

const closed = [
  { number: 5, merged_at: '2026-11-02T07:00:00Z' },
  { number: 6, merged_at: null },
  { number: 9, merged_at: '2026-11-02T07:00:00Z' },
];

describe('findMergedCommitKeys', () => {
  let github: Awaited<ReturnType<typeof startFakeGithub>>;

  beforeAll(async () => {
    github = await startFakeGithub(({ path }) => ({
      body: path.includes('state=closed') ? closed : [{ sha: 'a', commit: { author: { date: 'date' }, message: path } }],
    }));
  });

  afterAll(() => github.stop());

  it('has the commits of the other pull requests that were merged into the base', async () => {
    const target = { request: createGithubRequest('secret', github.url), repository: 'owner/name', base: 'master' };

    await expect(findMergedCommitKeys(target, 9)).resolves.toEqual(new Set(['date /repos/owner/name/pulls/5/commits?per_page=100']));
    expect(github.calls[0].path).toBe('/repos/owner/name/pulls?state=closed&base=master&sort=updated&direction=desc&per_page=30');
  });
});
