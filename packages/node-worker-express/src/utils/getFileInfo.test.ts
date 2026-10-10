import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import getCharset from './getCharset';
import getFileInfo, { getEtag } from './getFileInfo';

jest.mock('./getCharset', () => ({ __esModule: true, default: jest.fn() }));

const getCharsetMock = getCharset as jest.MockedFunction<typeof getCharset>;

describe('getFileInfo', () => {
  let folder: string;

  beforeAll(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'file-info-'));
  });

  afterAll(() => fs.rm(folder, { recursive: true, force: true }));

  beforeEach(() => {
    getCharsetMock.mockReset().mockResolvedValue('utf-8');
  });

  const create = async (name: string, content: string | Buffer) => {
    const fileName = path.join(folder, name);
    await fs.writeFile(fileName, content);

    return { fileName, stats: await fs.stat(fileName) };
  };

  it('describes a text file with its type and charset', async () => {
    const { fileName, stats } = await create('page.html', '<h1>hi</h1>');

    expect(await getFileInfo(fileName, stats)).toMatchObject({ contentType: 'text/html', charset: 'utf-8', etag: getEtag(stats) });
  });

  it('hands the beginning of the file to the charset detection', async () => {
    const { fileName, stats } = await create('bom.txt', Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x62]));

    await getFileInfo(fileName, stats);

    expect(getCharsetMock).toHaveBeenCalledWith(Buffer.from([0xef, 0xbb, 0xbf, 0x61]), fileName);
  });

  it('does not look for a charset of binary files', async () => {
    const { fileName, stats } = await create('icon.ico', Buffer.from([0, 1, 2, 3]));

    expect(await getFileInfo(fileName, stats)).toMatchObject({ contentType: 'image/vnd.microsoft.icon', charset: '' });
    expect(getCharsetMock).not.toHaveBeenCalled();
  });

  it('keeps the result until the file changes', async () => {
    const { fileName, stats } = await create('cached.css', 'a {}');

    await getFileInfo(fileName, stats);
    await getFileInfo(fileName, stats);
    expect(getCharsetMock).toHaveBeenCalledTimes(1);

    await fs.writeFile(fileName, 'a { color: red }');
    const changed = await fs.stat(fileName);
    const info = await getFileInfo(fileName, changed);

    expect(getCharsetMock).toHaveBeenCalledTimes(2);
    expect(info.etag).toBe(getEtag(changed));
    expect(info.etag).not.toBe(getEtag(stats));
  });

  it('forgets the oldest files when there are too many', async () => {
    // binary names are never read, so one real file gives the stats and creating a thousand files (slow on windows) is not needed
    const { stats } = await create('many.bin', 'x');
    const fileNames = Array.from({ length: 1001 }, (_, index) => path.join(folder, `many-${index}.bin`));
    // nothing is awaited for a binary name before it is kept, so they go into the cache in this order
    const infos = await Promise.all(fileNames.map((fileName) => getFileInfo(fileName, stats)));

    // a kept result is returned as the same object, a new one is a new object
    expect(await getFileInfo(fileNames[1000], stats)).toBe(infos[1000]);
    expect(await getFileInfo(fileNames[0], stats)).not.toBe(infos[0]);
  });
});
