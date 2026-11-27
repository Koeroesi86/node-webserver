import { createPullRequest, listAnswer, startFakeGithub } from '../test-helpers/fake-github';
import type { OpenPullRequest } from '../types/merge-queue';
import { applyAutomergeLabel } from './apply-automerge-label';
import { createGithubRequest } from './create-github-request';

const labelled = (number: number) => createPullRequest(number, { labels: { nodes: [{ name: 'automerge' }] } });

describe('applyAutomergeLabel', () => {
  let github: Awaited<ReturnType<typeof startFakeGithub>>;
  let pullRequests: OpenPullRequest[] = [];
  const target = () => ({ request: createGithubRequest('secret', github.url), repository: 'owner/name', base: 'master' });

  beforeAll(async () => {
    github = await startFakeGithub(({ body }) => {
      if (body.includes('pullRequests(')) return listAnswer(...pullRequests);

      return { body: body.includes('id-2') ? { errors: [{ message: 'denied' }] } : { data: {} } };
    });
  });

  afterAll(() => github.stop());

  it('says so when no pull request needs auto-merge', async () => {
    pullRequests = [createPullRequest(1)];

    await expect(applyAutomergeLabel(target())).resolves.toEqual({
      messages: ['No pull request to master with the automerge label needs auto-merge'],
      errors: [],
    });
  });

  it('turns auto-merge on for the others when one fails', async () => {
    pullRequests = [labelled(1), labelled(2), labelled(3)];

    const { messages, errors } = await applyAutomergeLabel(target());

    expect(messages).toEqual([expect.stringContaining('#1'), expect.stringContaining('#3')]);
    expect(errors.map(String)).toEqual([expect.stringContaining('denied')]);
  });
});
