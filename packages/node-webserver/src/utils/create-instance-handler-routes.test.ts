import fs from 'fs';
import os from 'os';
import path from 'path';
import loadInstances from './load-instances';
import type { ServerInstance } from '../types';

// the real middleware, as the routes are checked by it: a mistake in them has to stop the server while its configuration is loaded
describe('the routes of a worker server', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'instance-routes-'));
    fs.writeFileSync(path.join(root, 'worker.js'), '');
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const server = (routes: object[]): ServerInstance => ({
    hostname: 'routes.localhost',
    protocol: 'http',
    type: 'worker',
    // the configuration is JSON, so what the types rule out can still come
    options: JSON.parse(JSON.stringify({ root, routes })),
  });

  it.each([
    ['a worker that is not a file', { path: '/items', worker: 'missing.js' }, /is not a file/],
    ['a pattern that is not valid', { pattern: '/items/(', worker: 'worker.js' }, /is not valid/],
  ])('stop the servers from loading with %s', (_, route, message) => {
    expect(() => loadInstances([server([route])], [])).toThrow(message);
  });

  it('load when they are valid', async () => {
    const [loaded] = loadInstances([server([{ pattern: '/items/(?<id>[0-9]+)', worker: 'worker.js' }])], []);

    await loaded.close(0);
    expect(loaded.instance.hostname).toBe('routes.localhost');
  });
});
