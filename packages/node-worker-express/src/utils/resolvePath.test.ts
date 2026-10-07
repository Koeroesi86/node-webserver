import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import resolvePath from './resolvePath';

describe('resolvePath', () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-path-'));
    await fs.mkdir(path.join(root, 'static'));
    await fs.mkdir(path.join(root, 'app'));
    await fs.writeFile(path.join(root, 'exampleWorker.js'), '');
    await fs.writeFile(path.join(root, 'app', 'exampleWorker.js'), '');
    await fs.writeFile(path.join(root, 'static', 'index.html'), '');
  });

  afterAll(() => fs.rm(root, { recursive: true, force: true }));

  const resolve = (...fragments: string[]) => resolvePath(root, fragments, ['exampleWorker.js']);

  it('uses the index worker of a directory', async () => {
    expect(await resolve('app')).toMatchObject({ isWorker: true, pathExists: true, indexPath: path.join(root, 'app', 'exampleWorker.js') });
  });

  it('falls back to the index worker of a parent directory', async () => {
    expect(await resolve('app', 'missing', 'page')).toMatchObject({ isWorker: true, indexPath: path.join(root, 'app', 'exampleWorker.js') });
  });

  it('serves a directory without an index worker statically instead of treating it as a worker', async () => {
    expect(await resolve('static')).toMatchObject({ isWorker: false, pathExists: true });
  });

  it('serves a missing file below a directory without an index worker statically', async () => {
    expect(await resolve('static', 'missing.html')).toMatchObject({ isWorker: false, pathExists: true, indexPath: path.join(root, 'static', 'missing.html') });
  });

  it('serves an existing file statically', async () => {
    expect(await resolve('static', 'index.html')).toMatchObject({ isWorker: false, pathExists: true });
  });
});
