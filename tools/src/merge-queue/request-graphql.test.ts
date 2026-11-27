import { startFakeGithub } from '../test-helpers/fake-github';
import { createGithubRequest } from './create-github-request';
import { requestGraphql } from './request-graphql';

describe('requestGraphql', () => {
  let github: Awaited<ReturnType<typeof startFakeGithub>>;

  beforeAll(async () => {
    github = await startFakeGithub(({ body }) => (body.includes('denied') ? { body: { errors: [{ message: 'denied' }] } } : { body: { data: { ok: true } } }));
  });

  afterAll(() => github.stop());

  it('posts the query with its variables and gives the data', async () => {
    await expect(requestGraphql(createGithubRequest('secret', github.url), 'query', { id: '1' })).resolves.toEqual({ ok: true });
    expect(github.calls[0]).toMatchObject({ method: 'POST', path: '/graphql', body: JSON.stringify({ query: 'query', variables: { id: '1' } }) });
  });

  it('fails for the errors of an answer that is ok', async () => {
    await expect(requestGraphql(createGithubRequest('secret', github.url), 'denied', {})).rejects.toThrow('GraphQL: [{"message":"denied"}]');
  });
});
