import { createServer, type Server } from 'node:http';
import { fetchPublishedRelease } from './fetch-published-release';

describe('fetchPublishedRelease', () => {
  let server: Server;
  let registryUrl = '';
  const requested: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      requested.push(request.url ?? '');
      if (request.url?.includes('missing')) return void response.writeHead(404).end();
      if (request.url?.includes('broken')) return void response.writeHead(500, 'Server Error').end();
      response.end(JSON.stringify({ version: '1.2.3', gitHead: 'abc', name: 'ignored' }));
    });
    await new Promise<void>((done) => server.listen(0, () => done()));
    const address = server.address();
    registryUrl = `http://localhost:${typeof address === 'object' && address !== null ? address.port : 0}`;
  });

  afterAll(() => new Promise((done) => server.close(done)));

  it('is the version and the commit of the latest release, with the scope of the name escaped', async () => {
    expect(await fetchPublishedRelease('@scope/name', registryUrl)).toEqual({ version: '1.2.3', gitHead: 'abc' });
    expect(requested).toContain('/@scope%2Fname/latest');
  });

  it('is undefined for a package that was never published', async () => {
    expect(await fetchPublishedRelease('missing', registryUrl)).toBeUndefined();
  });

  it('fails for any other error status, and says which', async () => {
    await expect(fetchPublishedRelease('broken', registryUrl)).rejects.toThrow('Failed to look up broken');
  });
});
