import { unlink, readFile, writeFile, existsSync } from 'fs';
import type { StorageDriver } from '../types';

/**
 * Example driver for Storage
 */
const fileDriver: StorageDriver = {
  save: (path, data) => new Promise((res, rej) => writeFile(path, data, 'utf8', (err) => (err ? rej(err) : res()))),
  restore: (path) => new Promise((res, rej) => readFile(path, 'utf8', (err, data) => (err ? rej(err) : res(data)))),
  destroy: (path) => new Promise((res, rej) => (existsSync(path) ? unlink(path, (err) => (err ? rej(err) : res())) : setTimeout(res, 0))),
};

export default fileDriver;
