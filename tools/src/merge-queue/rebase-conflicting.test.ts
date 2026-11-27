import { createPullRequest, startFakeGithub } from '../test-helpers/fake-github';
import { createStack } from '../test-helpers/stacked-repository';
import { createGithubRequest } from './create-github-request';
import { createRemoteGit } from './create-remote-git';
import { rebaseConflicting } from './rebase-conflicting';

describe('rebaseConflicting', () => {
  let github: Awaited<ReturnType<typeof startFakeGithub>>;
  let stack: ReturnType<typeof createStack>;
  // whether GitHub says that the first commit of the branch belongs to a merged pull request
  let stacked = true;
  const rebase = (fields = {}) =>
    rebaseConflicting(
      {
        request: createGithubRequest('secret', github.url),
        git: createRemoteGit(stack.clone, 'secret'),
        repository: 'owner/name',
        base: 'master',
      },
      createPullRequest(2, { headRefName: 'child', headRefOid: stack.child, ...fields })
    );

  beforeAll(async () => {
    github = await startFakeGithub(({ path }) => {
      if (path.includes('state=closed')) return { body: [] };
      if (path.includes('/pulls/2/commits')) {
        return { body: [stack.lower, stack.child].map((sha) => ({ sha, commit: { author: { date: sha }, message: sha } })) };
      }

      return { body: stacked && path.includes(stack.lower) ? [{ number: 1, merged_at: '2026-11-02T07:00:00Z' }] : [] };
    });
  });

  afterEach(() => {
    stacked = true;
    stack.remove();
  });

  afterAll(() => github.stop());

  it('replays the own commits of a branch whose base was squash merged', async () => {
    stack = createStack();

    await expect(rebase()).resolves.toBe(`Replayed the commits of #2 after ${stack.lower} onto master`);
    expect(stack.origin.git('log', '--format=%s', `${stack.master}..child`)).toBe('child');
  });

  it('leaves a conflict of the own commits to the author', async () => {
    stack = createStack({ 'shared.txt': 'child' });

    await expect(rebase()).resolves.toBe('#2 has a conflict of its own commits, the queue waits for its author');
  });

  it('leaves a conflict without a merged pull request below to the author', async () => {
    stack = createStack();
    stacked = false;

    await expect(rebase()).resolves.toBe('#2 has a conflict, the queue waits for its author');
    expect(stack.origin.git('rev-parse', 'child')).toBe(stack.child);
  });

  it('does not push to a fork', async () => {
    stack = createStack();

    await expect(rebase({ isCrossRepository: true })).resolves.toBe('#2 has a conflict, the queue waits for its author');
    expect(stack.origin.git('rev-parse', 'child')).toBe(stack.child);
  });
});
