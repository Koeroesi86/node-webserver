import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import fileExists from './fileExists';

describe('fileExists', () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'file-exists-'));
  });

  afterEach(() => rm(folder, { recursive: true, force: true }));

  it('is true for a file that can be read', async () => {
    await writeFile(join(folder, 'a'), 'x');

    await expect(fileExists(join(folder, 'a'))).resolves.toBe(true);
  });

  it('is true for a folder', async () => {
    await expect(fileExists(folder)).resolves.toBe(true);
  });

  it('is false for a file that is not there', async () => {
    await expect(fileExists(join(folder, 'missing'))).resolves.toBe(false);
  });
});
