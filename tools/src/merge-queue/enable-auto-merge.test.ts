import { createPullRequest, startFakeGithub } from '../test-helpers/fake-github';
import { createGithubRequest } from './create-github-request';
import { enableAutoMerge } from './enable-auto-merge';

const refusals: Record<string, string> = {
  'id-2': 'Pull request Pull request is in clean status',
  'id-3': 'Pull request Pull request is in unstable status',
  'id-4': 'Auto-merge is not supported for stacked pull requests.',
  'id-5': 'Resource not accessible by personal access token',
};

describe('enableAutoMerge', () => {
  let github: Awaited<ReturnType<typeof startFakeGithub>>;
  const target = () => ({ request: createGithubRequest('secret', github.url), repository: 'owner/name', base: 'master' });
  const deleted = () => github.calls.filter(({ method }) => method === 'DELETE').map(({ path }) => path);

  beforeAll(async () => {
    github = await startFakeGithub(({ path, body }) => {
      const message = path === '/graphql' ? refusals[JSON.parse(body).variables.id] : undefined;

      return { body: message ? { errors: [{ message }] } : { data: {} } };
    });
  });

  afterAll(() => github.stop());

  it('turns squash auto-merge on and then takes the label off', async () => {
    await expect(enableAutoMerge(target(), createPullRequest(1))).resolves.toBe('Turned on squash auto-merge for #1 and took the label off');
    expect(github.calls[0].body).toContain('mergeMethod: SQUASH');
    expect(deleted()).toEqual(['/repos/owner/name/issues/1/labels/automerge']);
  });

  it.each([2, 3, 4])('keeps the label of #%i, which GitHub is expected to refuse', async (number) => {
    await expect(enableAutoMerge(target(), createPullRequest(number))).resolves.toContain(`#${number} keeps the automerge label`);
    expect(deleted()).not.toContain(`/repos/owner/name/issues/${number}/labels/automerge`);
  });

  it('fails for any other error, and keeps the label', async () => {
    await expect(enableAutoMerge(target(), createPullRequest(5))).rejects.toThrow('Resource not accessible');
    expect(deleted()).not.toContain('/repos/owner/name/issues/5/labels/automerge');
  });
});
