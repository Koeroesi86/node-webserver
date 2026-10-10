import { existsSync } from 'fs';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import FileStorage from './FileStorage';
import RequestEvent from './RequestEvent';

describe('FileStorage', () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'file-storage-'));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const create = (id: string) => new FileStorage(id, process, folder);

  const request = Object.assign(new RequestEvent(), { path: '/a', httpMethod: 'GET', headers: { a: 'b' }, queryStringParameters: { q: '1' } });

  it('needs the folder of the lambda', () => {
    expect(() => new FileStorage('abc', process)).toThrow('folder');
  });

  it('keeps a request and a response in files named by the id, in the folder', () => {
    const storage = create('abc');

    expect(storage.requestPath).toBe(resolve(folder, 'request-abc'));
    expect(storage.responsePath).toBe(resolve(folder, 'response-abc'));
  });

  it('stores and restores a request', async () => {
    await create('abc').setRequest(request);

    await expect(create('abc').getRequest()).resolves.toEqual({
      path: '/a',
      httpMethod: 'GET',
      headers: { a: 'b' },
      queryStringParameters: { q: '1' },
    });
  });

  it('stores and restores a response', async () => {
    await create('abc').setResponse({ statusCode: 201, body: 'ő' });

    await expect(create('abc').getResponse()).resolves.toEqual({ statusCode: 201, body: 'ő' });
  });

  it('does not mix the files of two folders', async () => {
    const other = await mkdtemp(join(tmpdir(), 'file-storage-'));

    try {
      await create('abc').setResponse({ statusCode: 201 });

      await expect(new FileStorage('abc', process, other).getResponse()).rejects.toThrow();
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('rejects when there is nothing stored', async () => {
    await expect(create('nothing').getResponse()).rejects.toThrow();
  });

  it('removes both files when destroyed, and does not mind when they are gone already', async () => {
    const storage = create('abc');
    await storage.setRequest(request);
    await storage.setResponse({ statusCode: 200 });
    await storage.destroy();

    expect(existsSync(storage.requestPath)).toBe(false);
    expect(existsSync(storage.responsePath)).toBe(false);
    await expect(storage.destroy()).resolves.toBeUndefined();
  });

  it('survives being destroyed twice at the same time, as the lambda and the middleware both do it', async () => {
    const storage = create('abc');
    await storage.setRequest(request);
    await storage.setResponse({ statusCode: 200 });

    await expect(Promise.all([storage.destroy(), storage.destroy()])).resolves.toEqual([undefined, undefined]);
  });

  it('does not reject when a file cannot be removed, as Windows refuses to remove one that is being removed', async () => {
    const storage = create('abc');
    // removing a folder that is not empty fails without recursive, like the refusal of the system does
    await mkdir(storage.responsePath);
    await writeFile(join(storage.responsePath, 'inside'), '');
    await storage.setRequest(request);

    await expect(storage.destroy()).resolves.toBeUndefined();
    // the other file is removed all the same
    expect(existsSync(storage.requestPath)).toBe(false);
  });
});
