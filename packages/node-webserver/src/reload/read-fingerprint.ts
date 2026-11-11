import { createHash } from 'crypto';
import type { Hash } from 'crypto';
import fs from 'fs';
import { types } from 'util';

// not instanceof: an error from node is not one of the realm of a test
const isDirectoryError = (error: unknown) => types.isNativeError(error) && 'code' in error && error.code === 'EISDIR';

/** a folder has no content to read, its real path says which one it is. Reading it fails with EISDIR, which saves checking before reading */
const readContent = (real: string): Buffer | undefined => {
  try {
    return fs.readFileSync(real);
  } catch (error) {
    return isDirectoryError(error) ? undefined : fail(error);
  }
};

const fail = (error: unknown): never => {
  throw error;
};

const update = (hash: Hash, file: string) => {
  const real = fs.realpathSync(file);
  hash.update(file).update(real);
  return hash.update(readContent(real) ?? '');
};

/** a hash of the real path and the content of the files, so that a link made to point elsewhere changes it. Undefined when one of them cannot be read */
const readFingerprint = (files: string[]): string | undefined => {
  try {
    return files.reduce(update, createHash('sha1')).digest('hex');
  } catch {
    return undefined;
  }
};

export default readFingerprint;
