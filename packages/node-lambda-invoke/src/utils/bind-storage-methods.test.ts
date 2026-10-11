import { bindStorageMethods } from './bind-storage-methods';

describe('bindStorageMethods', () => {
  it('keeps the methods of a storage bound to it when they are taken out of it', async () => {
    class Kept {
      stored: unknown;
      setResponse(response: unknown) {
        this.stored = response;
        return Promise.resolve();
      }
      getResponse() {
        return Promise.resolve(this.stored);
      }
      setRequest = jest.fn();
      getRequest = jest.fn();
      destroy = jest.fn();
    }
    const storage = new Kept();
    bindStorageMethods(storage as never);
    const { setResponse, getResponse } = storage;

    await setResponse({ statusCode: 200 });

    await expect(getResponse()).resolves.toEqual({ statusCode: 200 });
  });
});
