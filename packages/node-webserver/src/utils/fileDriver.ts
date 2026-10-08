import { readFile, writeFile } from 'fs';
import { rm } from 'fs/promises';
import type { StorageDriver } from '../types';

/**
 * Example driver for Storage
 */
const fileDriver: StorageDriver = {
  save: (path, data) => new Promise((res, rej) => writeFile(path, data, 'utf8', (err) => (err ? rej(err) : res()))),
  restore: (path) => new Promise((res, rej) => readFile(path, 'utf8', (err, data) => (err ? rej(err) : res(data)))),
  // the file may be gone already, which is not an error
  destroy: (path) => rm(path, { force: true }),
};

export default fileDriver;
