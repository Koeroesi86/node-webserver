import type { Storage } from '../types';

/** a storage is used through its methods on their own (`const { getResponse } = storage`), so they stay bound to it */
export const bindStorageMethods = (storage: Storage) =>
  Object.assign(storage, {
    setResponse: storage.setResponse.bind(storage),
    getResponse: storage.getResponse.bind(storage),
    setRequest: storage.setRequest.bind(storage),
    getRequest: storage.getRequest.bind(storage),
    destroy: storage.destroy.bind(storage),
  });
