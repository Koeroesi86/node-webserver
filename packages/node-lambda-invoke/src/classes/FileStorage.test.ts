import { existsSync } from 'fs';
import { resolve } from 'path';
import rimraf from 'rimraf';
import FileStorage from './FileStorage';
import RequestEvent from './RequestEvent';

describe('FileStorage', () => {
  const originalBases = { requestBase: FileStorage.requestBase, responseBase: FileStorage.responseBase };
  let base: string;

  beforeEach(() => {
    base = resolve(__dirname, '../..', `.test-file-storage-${process.pid}-${Date.now()}`);
    FileStorage.requestBase = resolve(base, 'requests');
    FileStorage.responseBase = resolve(base, 'responses');
    FileStorage.start();
  });

  afterEach(() => {
    rimraf.sync(base);
    Object.assign(FileStorage, originalBases);
  });

  const request = Object.assign(new RequestEvent(), { path: '/a', httpMethod: 'GET', headers: { a: 'b' }, queryStringParameters: { q: '1' } });

  it('creates the folders when it starts, and empties them', async () => {
    await new FileStorage('old').setRequest(request);
    FileStorage.start();

    expect(existsSync(FileStorage.requestBase)).toBe(true);
    expect(existsSync(FileStorage.responseBase)).toBe(true);
    expect(existsSync(new FileStorage('old').requestPath)).toBe(false);
  });

  it('keeps a request and a response in files named by the id', () => {
    const storage = new FileStorage('abc');

    expect(storage.requestPath).toBe(resolve(FileStorage.requestBase, 'abc'));
    expect(storage.responsePath).toBe(resolve(FileStorage.responseBase, 'abc'));
  });

  it('stores and restores a request', async () => {
    await new FileStorage('abc').setRequest(request);

    await expect(new FileStorage('abc').getRequest()).resolves.toEqual({
      path: '/a',
      httpMethod: 'GET',
      headers: { a: 'b' },
      queryStringParameters: { q: '1' },
    });
  });

  it('stores and restores a response', async () => {
    await new FileStorage('abc').setResponse({ statusCode: 201, body: 'ő' });

    await expect(new FileStorage('abc').getResponse()).resolves.toEqual({ statusCode: 201, body: 'ő' });
  });

  it('rejects when there is nothing stored', async () => {
    await expect(new FileStorage('nothing').getResponse()).rejects.toThrow();
  });

  it('removes both files when destroyed, and does not mind when they are gone already', async () => {
    const storage = new FileStorage('abc');
    await storage.setRequest(request);
    await storage.setResponse({ statusCode: 200 });
    await storage.destroy();

    expect(existsSync(storage.requestPath)).toBe(false);
    expect(existsSync(storage.responsePath)).toBe(false);
    await expect(storage.destroy()).resolves.toBeDefined();
  });

  it('survives being destroyed twice at the same time, as the lambda and the middleware both do it', async () => {
    const storage = new FileStorage('abc');
    await storage.setRequest(request);
    await storage.setResponse({ statusCode: 200 });

    await expect(Promise.all([storage.destroy(), storage.destroy()])).resolves.toBeDefined();
  });
});
