import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { createPullRequest, listAnswer, startFakeGithub } from '../test-helpers/fake-github';
import { createStack } from '../test-helpers/stacked-repository';

const script = resolve(__dirname, '../../dist/scripts/rebase-auto-merge.js');

describe('rebase-auto-merge script', () => {
  let github: Awaited<ReturnType<typeof startFakeGithub>>;
  const stack = createStack();
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

  afterAll(async () => {
    stack.remove();
    await github.stop();
  });

  it('replays a stack in the checkout it runs in', async () => {
    await expect(run()).resolves.toMatchObject({ stdout: `Replayed the commits of #2 after ${stack.lower} onto master\n` });
    expect(stack.origin.git('log', '--format=%s', `${stack.master}..child`)).toBe('child');
  });

  it('exits with 1 when GitHub fails', async () => {
    status = 500;

    await expect(run()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('answered 500') });
  });
});
