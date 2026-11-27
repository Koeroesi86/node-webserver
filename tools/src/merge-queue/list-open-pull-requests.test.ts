import { createPullRequest, listAnswer, startFakeGithub } from '../test-helpers/fake-github';
import { createGithubRequest } from './create-github-request';
import { listOpenPullRequests } from './list-open-pull-requests';

describe('listOpenPullRequests', () => {
  let github: Awaited<ReturnType<typeof startFakeGithub>>;

  beforeAll(async () => {
    github = await startFakeGithub(() => listAnswer(createPullRequest(1)));
  });

  afterAll(() => github.stop());

  it('asks for the pull requests of the repository to the base', async () => {
    const target = { request: createGithubRequest('secret', github.url), repository: 'owner/name', base: 'master' };

    await expect(listOpenPullRequests(target)).resolves.toEqual([createPullRequest(1)]);
    expect(JSON.parse(github.calls[0].body).variables).toEqual({ owner: 'owner', name: 'name', base: 'master' });
  });
});
