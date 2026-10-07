import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import getCharset from './getCharset';

describe('getCharset', () => {
  let folder: string;

  beforeAll(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'charset-'));
  });

  afterAll(() => fs.rm(folder, { recursive: true, force: true }));

  it('detects a byte order mark', async () => {
    expect(await getCharset(Buffer.from([0xef, 0xbb, 0xbf, 0x61]), 'unused')).toBe('utf8');
  });

  it('does not run anything from a file name', async () => {
    // a shell would run the part after the semicolon in the working directory
    const fileName = path.join(folder, 'file; touch marker');
    await fs.writeFile(fileName, 'text');
    const workingDirectory = process.cwd();
    process.chdir(folder);

    try {
      await getCharset(Buffer.from('text'), fileName);
    } finally {
      process.chdir(workingDirectory);
    }

    await expect(fs.access(path.join(folder, 'marker'))).rejects.toThrow();
  });
});
