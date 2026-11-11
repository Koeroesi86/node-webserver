import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import readDirectoryNames from './read-directory-names';

describe('readDirectoryNames', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'directory-names-'));
    await Promise.all(['a.txt', 'B.txt', 'c.txt'].map((name) => fs.writeFile(path.join(directory, name), '')));
  });

  afterAll(() => fs.rm(directory, { recursive: true, force: true }));

  it('returns the names the way the function given writes them', async () => {
    expect(await readDirectoryNames(directory, 10, (name) => name.toLowerCase())).toEqual(new Set(['a.txt', 'b.txt', 'c.txt']));
  });

  it('returns the names of a directory with exactly as many entries as the limit', async () => {
    expect((await readDirectoryNames(directory, 3, (name) => name))?.size).toBe(3);
  });

  it('returns undefined for a directory with more entries than the limit, without reading them all', async () => {
    const normalize = jest.fn((name: string) => name);

    expect(await readDirectoryNames(directory, 1, normalize)).toBeUndefined();
    expect(normalize.mock.calls.length).toBeLessThan(3);
  });

  it('rejects for a directory that is not there', async () => {
    await expect(readDirectoryNames(path.join(directory, 'missing'), 10, (name) => name)).rejects.toThrow();
  });
});
