import { resolve } from 'path';
import Storage from './storage';
import { PACKAGE_ROOT } from '../constants';
import type { StorageDriver } from '../types';

const createDriver = (): jest.Mocked<StorageDriver> => ({
  save: jest.fn().mockResolvedValue(undefined),
  restore: jest.fn(),
  destroy: jest.fn().mockResolvedValue(undefined),
});

describe('Storage', () => {
  it('keeps the request and the response in files named by the id', () => {
    const storage = new Storage('abc', createDriver());

    expect(storage.requestPath).toBe(resolve(PACKAGE_ROOT, 'requests/abc'));
    expect(storage.responsePath).toBe(resolve(PACKAGE_ROOT, 'responses/abc'));
  });

  it('saves a request serialized', async () => {
    const driver = createDriver();
    await new Storage('abc', driver).setRequest({
      path: '/',
      pathFragments: [],
      rootPath: '/',
      protocol: 'http',
      remoteAddress: '127.0.0.1',
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: {},
    });

    expect(driver.save).toHaveBeenCalledWith(resolve(PACKAGE_ROOT, 'requests/abc'), expect.stringContaining('"httpMethod":"GET"'));
  });

  it('saves a response serialized', async () => {
    const driver = createDriver();
    await new Storage('abc', driver).setResponse({ statusCode: 201 });

    expect(driver.save).toHaveBeenCalledWith(resolve(PACKAGE_ROOT, 'responses/abc'), '{"statusCode":201}');
  });

  it('restores a request and a response deserialized', async () => {
    const driver = createDriver();
    driver.restore.mockImplementation(async (path) => (path.includes('requests') ? '{"path":"/a"}' : '{"statusCode":404}'));
    const storage = new Storage('abc', driver);

    await expect(storage.getRequest()).resolves.toEqual({ path: '/a' });
    await expect(storage.getResponse()).resolves.toEqual({ statusCode: 404 });
  });

  it('rejects when the stored data cannot be read', async () => {
    const driver = createDriver();
    driver.restore.mockResolvedValue('not json');

    await expect(new Storage('abc', driver).getResponse()).rejects.toThrow(SyntaxError);
  });

  it('destroys both files', async () => {
    const driver = createDriver();
    await new Storage('abc', driver).destroy();

    expect(driver.destroy.mock.calls.map(([path]) => path).sort()).toEqual(
      [resolve(PACKAGE_ROOT, 'requests/abc'), resolve(PACKAGE_ROOT, 'responses/abc')].sort()
    );
  });

  it('works when its methods are passed around', async () => {
    const driver = createDriver();
    const { setResponse } = new Storage('abc', driver);
    await setResponse({ statusCode: 200 });

    expect(driver.save).toHaveBeenCalledTimes(1);
  });
});
