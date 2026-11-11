import { createServer, type Server } from 'node:http';
import { createRepository } from '../test-helpers/git-repository';
import { planVersions } from './plan-versions';

describe('planVersions', () => {
  const repository = createRepository();
  const packageJson = (name: string, more: object = {}) => JSON.stringify({ name, ...more });
  const published: Record<string, { version: string; gitHead: string }> = {};
  let server: Server;
  let registryUrl = '';
  let base = '';

  beforeAll(async () => {
    base = repository.commit({
      'packages/core/package.json': packageJson('@scope/core'),
      'packages/app/package.json': packageJson('@scope/app', { dependencies: { '@scope/core': 'workspace:*' } }),
      'packages/solo/package.json': packageJson('@scope/solo'),
      'packages/hidden/package.json': packageJson('@scope/hidden', { private: true }),
    });
    server = createServer((request, response) => {
      const release = published[decodeURIComponent(request.url ?? '').replace(/^\/|\/latest$/g, '')];
      if (release === undefined) return void response.writeHead(404).end();
      response.end(JSON.stringify(release));
    });
    await new Promise<void>((done) => server.listen(0, () => done()));
    const address = server.address();
    registryUrl = `http://localhost:${typeof address === 'object' && address !== null ? address.port : 0}`;
  });

  afterAll(async () => {
    repository.remove();
    await new Promise((done) => server.close(done));
  });

  const reasons = async (publishAll = false) => {
    const { plan } = await planVersions(repository.path, registryUrl, publishAll);

    return Object.fromEntries(plan.map(({ item, reason }) => [item.packageJson.name, reason]));
  };

  it('publishes everything that never was, and leaves out the private packages', async () => {
    expect(await reasons()).toEqual({ '@scope/app': 'never published', '@scope/core': 'never published', '@scope/solo': 'never published' });
  });

  it('gives the commit that is checked out', async () => {
    expect((await planVersions(repository.path, registryUrl)).head).toBe(base);
  });

  it('publishes nothing when everything is published from this commit', async () => {
    ['@scope/app', '@scope/core', '@scope/solo'].forEach((name) => (published[name] = { version: '1.0.0', gitHead: base }));

    expect(await reasons()).toEqual({ '@scope/app': undefined, '@scope/core': undefined, '@scope/solo': undefined });
  });

  it('publishes a package that changed, and the ones that depend on it', async () => {
    repository.commit({ 'packages/core/index.js': 'changed' });

    expect(await reasons()).toEqual({
      '@scope/app': `@scope/core changed since ${base.substring(0, 7)}`,
      '@scope/core': `changed since ${base.substring(0, 7)}`,
      '@scope/solo': undefined,
    });
  });

  it('publishes everything when it is asked to', async () => {
    expect(await reasons(true)).toEqual({ '@scope/app': 'PUBLISH_ALL is set', '@scope/core': 'PUBLISH_ALL is set', '@scope/solo': 'PUBLISH_ALL is set' });
  });
});
