import { startFakeGithub } from '../test-helpers/fake-github';
import { createGithubRequest } from './create-github-request';

describe('createGithubRequest', () => {
  let github: Awaited<ReturnType<typeof startFakeGithub>>;

  beforeAll(async () => {
    github = await startFakeGithub(({ path }) => (path === '/missing' ? { status: 404, body: { message: 'Not Found' } } : { body: { behind_by: 1 } }));
  });

  afterAll(() => github.stop());

  it('sends the token, the method and the body, and gives the parsed answer', async () => {
    await expect(createGithubRequest('secret', github.url)('/repos/a/b', { method: 'PUT', body: '{}' })).resolves.toEqual({ behind_by: 1 });
    expect(github.calls).toContainEqual({ method: 'PUT', path: '/repos/a/b', authorization: 'Bearer secret', body: '{}' });
  });

  it('fails for a status that is not ok, with the method, the status and the answer', async () => {
    await expect(createGithubRequest('secret', github.url)('/missing')).rejects.toThrow('GET /missing answered 404: {"message":"Not Found"}');
    await expect(createGithubRequest('secret', github.url)('/missing', { method: 'DELETE' })).rejects.toThrow('DELETE /missing answered 404');
  });
});
