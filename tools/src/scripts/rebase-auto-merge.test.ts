import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { createPullRequest, listAnswer, startFakeGithub } from '../test-helpers/fake-github';
import { createStack } from '../test-helpers/stacked-repository';

const script = resolve(__dirname, '../../dist/scripts/rebase-auto-merge.js');

// every test builds repositories and runs the script, many processes, which are slow to start on the Windows runners
jest.setTimeout(60_000);

describe('rebase-auto-merge script', () => {
  let github: Awaited<ReturnType<typeof startFakeGithub>>;
  let stack: ReturnType<typeof createStack>;
  let status = 200;
  // not spawnSync, which would block the server that answers the script
  const run = () =>
    promisify(execFile)('node', [script], {
      cwd: stack.clone,
      env: { ...process.env, GH_TOKEN: 'secret', GITHUB_REPOSITORY: 'owner/name', GITHUB_API_URL: github.url },
    });

  beforeAll(async () => {
    github = await startFakeGithub(({ path }) => {
      if (path === '/graphql') {
        const fields = { headRefName: 'child', headRefOid: stack.child, autoMergeRequest: { enabledAt: '2026-11-02T08:00:00Z' } };

        return { status, ...listAnswer(createPullRequest(2, { ...fields, mergeable: 'CONFLICTING' })) };
      }
      if (path.includes('state=closed')) return { body: [] };
      if (path.includes('/pulls/2/commits')) {
        return { body: [stack.lower, stack.child].map((sha) => ({ sha, commit: { author: { date: sha }, message: sha } })) };
      }

      return { body: path.includes(stack.lower) ? [{ number: 1, merged_at: '2026-11-02T07:00:00Z' }] : [] };
    });
  });

  afterEach(() => {
    status = 200;
    stack.remove();
  });

  afterAll(() => github.stop());

  it('replays a stack in the checkout it runs in', async () => {
    stack = createStack();

    await expect(run()).resolves.toMatchObject({ stdout: `Replayed the commits of #2 after ${stack.lower} onto master\n` });
    expect(stack.origin.git('log', '--format=%s', `${stack.master}..child`)).toBe('child');
  });

  it('pushes nothing when the own commits conflict', async () => {
    stack = createStack({ 'shared.txt': 'child' });

    await expect(run()).resolves.toMatchObject({ stdout: '#2 has a conflict of its own commits, the queue waits for its author\n' });
    expect(stack.origin.git('rev-parse', 'child')).toBe(stack.child);
  });

  it('does not overwrite a branch that moved', async () => {
    stack = createStack();
    stack.origin.git('switch', '-q', 'child');
    const moved = stack.origin.commit({ 'more.txt': 'more' });
    stack.origin.git('switch', '-q', 'master');

    await expect(run()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('stale info') });
    expect(stack.origin.git('rev-parse', 'child')).toBe(moved);
  });

  it('exits with 1 when GitHub fails', async () => {
    stack = createStack();
    status = 500;

    await expect(run()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('answered 500') });
  });
});
