import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { startFakeGithub } from '../test-helpers/fake-github';
import { createStack } from '../test-helpers/stacked-repository';

const script = resolve(__dirname, '../../dist/scripts/close-merged-branches.js');

// builds repositories and runs the script, many processes, which are slow to start on the Windows runners
jest.setTimeout(60_000);

describe('close-merged-branches script', () => {
  let github: Awaited<ReturnType<typeof startFakeGithub>>;
  let stack: ReturnType<typeof createStack>;
  let status = 200;
  const git = (...args: string[]) => stack.origin.git('-C', stack.clone, ...args);
  // not spawnSync, which would block the server that answers the script
  const run = (...args: string[]) =>
    promisify(execFile)('node', [script, ...args], {
      cwd: stack.clone,
      env: { ...process.env, GH_TOKEN: 'secret', GITHUB_REPOSITORY: 'owner/name', GITHUB_API_URL: github.url },
    });

  beforeAll(async () => {
    github = await startFakeGithub(({ path }) => {
      const merged = { number: 1, merged_at: '2026-11-02T07:00:00Z', merge_commit_sha: stack.master, head: { sha: stack.lower } };

      return { status, body: path.includes('head=owner%3Alower') ? [merged] : [] };
    });
  });

  beforeEach(() => {
    status = 200;
    stack = createStack();
    git('branch', '-q', 'lower', 'origin/lower');
    git('branch', '-q', 'child', 'origin/child');
  });

  afterEach(() => {
    stack.remove();
    rmSync(stack.clone, { recursive: true, force: true });
  });

  afterAll(() => github.stop());

  it('lists the merged branches without deleting them', async () => {
    await expect(run()).resolves.toMatchObject({
      stdout: `kept child: no pull request of this branch name is merged into master\nwould delete lower (at ${stack.lower}), merged by #1\n`,
    });
    expect(git('branch', '--list', 'lower')).toContain('lower');
  });

  it('deletes the merged branches of the checkout it runs in', async () => {
    await expect(run('--delete')).resolves.toMatchObject({ stdout: expect.stringContaining(`deleted lower (was ${stack.lower}), merged by #1`) });
    expect(git('for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads')).toBe('child\nmaster');
  });

  it('exits with 1 and deletes nothing when GitHub fails', async () => {
    status = 500;

    await expect(run('--delete')).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('answered 500') });
    expect(git('branch', '--list', 'lower')).toContain('lower');
  });
});
