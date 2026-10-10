import { createHash } from 'crypto';
import fs from 'fs';

/** a hash of the content of the files, undefined when one of them cannot be read */
const readFingerprint = (files: string[]): string | undefined => {
  try {
    return files.reduce((hash, file) => hash.update(file).update(fs.readFileSync(file)), createHash('sha1')).digest('hex');
  } catch {
    return undefined;
  }
};

export default readFingerprint;
