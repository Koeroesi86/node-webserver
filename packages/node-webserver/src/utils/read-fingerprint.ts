import { createHash } from 'crypto';
import type { Hash } from 'crypto';
import fs from 'fs';

/** a folder has no content to read, its real path says which one it is */
const update = (hash: Hash, file: string) => {
  const real = fs.realpathSync(file);
  hash.update(file).update(real);
  return fs.statSync(real).isDirectory() ? hash : hash.update(fs.readFileSync(real));
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
