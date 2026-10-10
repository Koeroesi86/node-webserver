import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import createProbe from './createProbe';
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
    expect(await resolve('static', 'index.html')).toMatchObject({ isWorker: false, pathExists: true, targetExists: true });
  });

  it('tells whether the requested path itself exists, not only a directory above it', async () => {
    expect(await resolve('static', 'missing.html')).toMatchObject({ targetExists: false });
    expect(await resolve('static', 'missing', 'index.html')).toMatchObject({ targetExists: false });
    expect(await resolve('static')).toMatchObject({ targetExists: true });
    expect(await resolve()).toMatchObject({ targetExists: true });
    expect(await resolve('app', 'missing', 'page')).toMatchObject({ isWorker: true, targetExists: false });
  });

  describe('with a probe', () => {
    it('asks the probe, so that answers can be remembered', async () => {
      const probe = { exists: jest.fn().mockResolvedValue(false), stat: jest.fn() };

      const result = await resolvePath(root, ['app', 'page'], ['exampleWorker.js'], probe);

      expect(result.pathExists).toBe(false);
      expect(probe.exists.mock.calls.map(([fileName]) => fileName)).toEqual([path.join(root, 'app', 'page'), path.join(root, 'app'), root]);
      expect(probe.stat).not.toHaveBeenCalled();
    });

    it('goes on with the parent when a path is gone since it was found', async () => {
      const probe = {
        exists: jest.fn().mockResolvedValue(true),
        stat: jest.fn(async (fileName: string) => (fileName === path.join(root, 'app', 'page') ? undefined : fs.stat(fileName))),
      };

      const result = await resolvePath(root, ['app', 'page'], ['exampleWorker.js'], probe);

      expect(result).toMatchObject({ isWorker: true, pathExists: true, indexPath: path.join(root, 'app', 'exampleWorker.js') });
    });

    it('costs the file system only the question about the new part for requests to many different paths', async () => {
      const access = jest.spyOn(fs, 'access');
      const probe = createProbe();

      await resolvePath(root, ['app', 'scan', '0'], ['exampleWorker.js'], probe);
      const afterFirst = access.mock.calls.length;
      await Promise.all(Array.from({ length: 100 }, (_, index) => resolvePath(root, ['app', 'scan', String(index + 1)], ['exampleWorker.js'], probe)));

      // one question for every new leaf, the directories above it are answered from memory
      expect(access.mock.calls.length - afterFirst).toBe(100);
      access.mockRestore();
    });
  });
});
