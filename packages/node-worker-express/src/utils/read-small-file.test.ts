import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import readSmallFile from './read-small-file';

jest.mock('../constants', () => ({ ...jest.requireActual('../constants'), StaticFileCache: { entries: 3, bytes: 10 } }));

describe('readSmallFile', () => {
  let folder: string;

  beforeAll(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'read-small-file-'));
  });

  afterAll(() => fs.rm(folder, { recursive: true, force: true }));

  afterEach(() => jest.restoreAllMocks());

  const create = async (name: string, content: string) => {
    const fileName = path.join(folder, name);
    await fs.writeFile(fileName, content);

    return fileName;
  };
  const read = async (fileName: string) => readSmallFile(fileName, await fs.stat(fileName));
  const spyOnReadFile = () => jest.spyOn(fs, 'readFile');

  it('reads a file once while it does not change', async () => {
    const fileName = await create('same.txt', 'same');
    const readFile = spyOnReadFile();

    expect(`${await read(fileName)}`).toBe('same');
    expect(`${await read(fileName)}`).toBe('same');
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('reads a file again when its size changed', async () => {
    const fileName = await create('size.txt', 'one');
    await read(fileName);

    await fs.writeFile(fileName, 'three');

    expect(`${await read(fileName)}`).toBe('three');
  });

  it('reads a file again when its modification time changed', async () => {
    const fileName = await create('time.txt', 'old');
    await read(fileName);
    await fs.writeFile(fileName, 'new');
    // the same size, so only the time tells the change
    await fs.utimes(fileName, new Date(), new Date(Date.now() + 60000));

    expect(`${await read(fileName)}`).toBe('new');
  });

  it('does not keep a file that changed after it was described', async () => {
    const fileName = await create('changing.txt', 'after the stat');
    // the stats of a shorter file stand for the ones taken before the file grew
    const { stats } = await create('changing-before.txt', 'before');
    const readFile = spyOnReadFile();

    await readSmallFile(fileName, stats);
    await readSmallFile(fileName, stats);

    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it('forgets the least recently used file above the number of entries', async () => {
    const [a, b, c, d] = await Promise.all(['a', 'b', 'c', 'd'].map((name) => create(`entries-${name}.txt`, name)));
    await read(a);
    await read(b);
    await read(c);
    // a is used again, so b is the oldest
    await read(a);
    await read(d);
    const readFile = spyOnReadFile();

    await Promise.all([a, c, d].map(read));
    expect(readFile).not.toHaveBeenCalled();
    await read(b);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('forgets the least recently used files above the number of bytes', async () => {
    const small = await create('bytes-small.txt', '1234');
    const big = await create('bytes-big.txt', '12345678');
    await read(small);
    await read(big);
    const readFile = spyOnReadFile();

    await read(big);
    expect(readFile).not.toHaveBeenCalled();
    await read(small);
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
