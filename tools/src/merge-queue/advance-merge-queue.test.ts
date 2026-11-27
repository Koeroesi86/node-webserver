import { createPullRequest, type GithubAnswer, listAnswer, startFakeGithub } from '../test-helpers/fake-github';
import type { OpenPullRequest } from '../types/merge-queue';
import { advanceMergeQueue } from './advance-merge-queue';
import { createGithubRequest } from './create-github-request';

const queued = (number: number, fields: Partial<OpenPullRequest> = {}) =>
  createPullRequest(number, { autoMergeRequest: { enabledAt: `2026-11-02T0${number}:00:00Z` }, ...fields });

describe('advanceMergeQueue', () => {
  let github: Awaited<ReturnType<typeof startFakeGithub>>;
  let pullRequests: OpenPullRequest[] = [];
  let behind = 0;
  let update: GithubAnswer = { body: {} };
  const git = jest.fn();
  const advance = () => advanceMergeQueue({ request: createGithubRequest('secret', github.url), git, repository: 'owner/name', base: 'master' });
  const paths = () => github.calls.map(({ path }) => path);

  beforeAll(async () => {
    github = await startFakeGithub(({ path }) => {
      if (path === '/graphql') return listAnswer(...pullRequests);
      if (path.includes('/compare/')) return { body: { behind_by: behind } };
      if (path.endsWith('/update-branch')) return update;

      return { body: [] };
    });
  });

  beforeEach(() => {
    pullRequests = [queued(2), queued(1)];
    behind = 3;
    update = { status: 202, body: {} };
    github.calls.length = 0;
  });

  afterAll(() => github.stop());

  it('does nothing without a pull request with auto-merge', async () => {
    pullRequests = [createPullRequest(1)];

    await expect(advance()).resolves.toBe('No pull request has auto-merge on');
    expect(paths()).toEqual(['/graphql']);
  });

  it('rebases the first pull request that is behind, on the head it saw', async () => {
    await expect(advance()).resolves.toBe('Rebased #1, 3 commits behind master');
    expect(github.calls.at(-1)).toMatchObject({
      method: 'PUT',
      path: '/repos/owner/name/pulls/1/update-branch',
      body: JSON.stringify({ expected_head_sha: 'head-1', update_method: 'rebase' }),
    });
  });

  it('waits for the first pull request while it is up to date, and leaves the next one behind', async () => {
    behind = 0;

    await expect(advance()).resolves.toBe('#1 is up to date, the queue waits for it to merge');
    expect(paths()).toEqual(['/graphql', '/repos/owner/name/compare/master...head-1']);
  });

  it('does not ask GitHub to rebase a pull request that conflicts', async () => {
    pullRequests = [queued(1, { mergeable: 'CONFLICTING' })];

    await expect(advance()).resolves.toBe('#1 has a conflict, the queue waits for its author');
    expect(paths()).not.toContain('/repos/owner/name/pulls/1/update-branch');
  });

  it('looks for a stack when GitHub cannot rebase a pull request that can be merged', async () => {
    update = { status: 422, body: { message: 'PullRequest::RebaseConflictError' } };

    await expect(advance()).resolves.toBe('#1 has a conflict, the queue waits for its author');
    expect(paths()).toContain('/repos/owner/name/pulls/1/commits?per_page=100');
  });

  it('fails for any other refusal to rebase', async () => {
    update = { status: 422, body: { message: 'expected head sha didn’t match current head ref.' } };

    await expect(advance()).rejects.toThrow('answered 422');
    expect(git).not.toHaveBeenCalled();
  });
});
