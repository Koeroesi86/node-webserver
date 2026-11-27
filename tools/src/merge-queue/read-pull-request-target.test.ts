import { startFakeGithub } from '../test-helpers/fake-github';
import { readPullRequestTarget } from './read-pull-request-target';

describe('readPullRequestTarget', () => {
  const env = { GH_TOKEN: 'secret', GITHUB_REPOSITORY: 'owner/name' };

  it('is the repository and the token of the environment, to master', () => {
    expect(readPullRequestTarget(env)).toMatchObject({ token: 'secret', repository: 'owner/name', base: 'master' });
    expect(readPullRequestTarget(env, 'next').base).toBe('next');
  });

  it('requests the api of GITHUB_API_URL with the token', async () => {
    const github = await startFakeGithub(() => ({ body: {} }));

    await readPullRequestTarget({ ...env, GITHUB_API_URL: github.url }).request('/path');
    await github.stop();

    expect(github.calls).toMatchObject([{ path: '/path', authorization: 'Bearer secret' }]);
  });

  it.each(['GH_TOKEN', 'GITHUB_REPOSITORY'])('fails without %s', (name) => {
    expect(() => readPullRequestTarget({ ...env, [name]: '' })).toThrow(`${name} is not set`);
  });
});
