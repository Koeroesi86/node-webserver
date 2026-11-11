import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import findPrecompressed from './find-precompressed';

describe('findPrecompressed', () => {
  let folder: string;
  let file: string;

  beforeAll(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'precompressed-'));
    file = path.join(folder, 'app.js');
    await fs.writeFile(`${file}.br`, 'br');
    await fs.mkdir(path.join(folder, 'dir.js.gz'));
  });

  afterAll(() => fs.rm(folder, { recursive: true, force: true }));

  it('chooses an existing variant the client accepts', async () => {
    expect(await findPrecompressed(file, 'gzip, br', ['gzip', 'br'])).toMatchObject({ varies: true, chosen: { encoding: 'br', fileName: `${file}.br` } });
  });

  it.each([undefined, '', 'gzip', 'br;q=0', 'identity'])('chooses none for the header %s, but varies', async (header) => {
    expect(await findPrecompressed(file, header, ['gzip', 'br'])).toEqual({ varies: true, chosen: undefined });
  });

  it('does not vary without variants, and a folder is none', async () => {
    expect(await findPrecompressed(path.join(folder, 'none.js'), 'br', ['br', 'gzip'])).toEqual({ varies: false, chosen: undefined });
    expect(await findPrecompressed(path.join(folder, 'dir.js'), 'gzip', ['gzip'])).toEqual({ varies: false, chosen: undefined });
  });

  it('looks for nothing without encodings', async () => {
    expect(await findPrecompressed(file, 'br', [])).toEqual({ varies: false, chosen: undefined });
  });
});
