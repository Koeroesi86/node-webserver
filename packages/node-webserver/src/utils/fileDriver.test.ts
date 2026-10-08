import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import fileDriver from './fileDriver';

describe('fileDriver', () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'file-driver-'));
  });

  afterEach(() => rm(folder, { recursive: true, force: true }));

  it('saves data to a file', async () => {
    await fileDriver.save(join(folder, 'a'), 'ő data');

    expect(await readFile(join(folder, 'a'), 'utf8')).toBe('ő data');
  });

  it('restores the data of a file', async () => {
    await writeFile(join(folder, 'a'), 'stored');

    await expect(fileDriver.restore(join(folder, 'a'))).resolves.toBe('stored');
  });

  it('rejects when saving or restoring fails', async () => {
    await expect(fileDriver.save(join(folder, 'missing', 'a'), 'data')).rejects.toThrow();
    await expect(fileDriver.restore(join(folder, 'missing'))).rejects.toThrow();
  });

  it('removes a file', async () => {
    await writeFile(join(folder, 'a'), 'stored');
    await fileDriver.destroy(join(folder, 'a'));

    expect(existsSync(join(folder, 'a'))).toBe(false);
  });

  it('does not mind being asked to remove a file twice at the same time', async () => {
    await writeFile(join(folder, 'a'), 'stored');

    await expect(Promise.all([fileDriver.destroy(join(folder, 'a')), fileDriver.destroy(join(folder, 'a'))])).resolves.toBeDefined();
  });

  it('does not mind a file that is already gone', async () => {
    await expect(fileDriver.destroy(join(folder, 'gone'))).resolves.toBeUndefined();
  });
});
