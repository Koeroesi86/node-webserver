import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { createPullRequest, listAnswer, startFakeGithub } from '../test-helpers/fake-github';

const script = resolve(__dirname, '../../dist/scripts/automerge-label.js');

describe('automerge-label script', () => {
  let github: Awaited<ReturnType<typeof startFakeGithub>>;
  let refusal = '';
  // not spawnSync, which would block the server that answers the script
  const run = (env: NodeJS.ProcessEnv = {}) =>
    promisify(execFile)('node', [script], {
      env: { ...process.env, GH_TOKEN: 'secret', GITHUB_REPOSITORY: 'owner/name', GITHUB_API_URL: github.url, ...env },
    });

  beforeAll(async () => {
    github = await startFakeGithub(({ body }) => {
      if (body.includes('pullRequests(')) return listAnswer(createPullRequest(1, { labels: { nodes: [{ name: 'automerge' }] } }));

      return { body: refusal ? { errors: [{ message: refusal }] } : { data: {} } };
    });
  });

  afterAll(() => github.stop());

  it('says what it turned on', async () => {
    await expect(run()).resolves.toMatchObject({ stdout: 'Turned on squash auto-merge for #1 and took the label off\n' });
  });

  it('exits with 1 when a pull request could not get auto-merge', async () => {
    refusal = 'denied';

    await expect(run()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('denied') });
  });

  it('fails without a token', async () => {
    await expect(run({ GH_TOKEN: '' })).rejects.toMatchObject({ stderr: expect.stringContaining('GH_TOKEN is not set') });
  });
});
