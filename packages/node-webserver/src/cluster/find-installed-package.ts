import fs from 'fs';
import path from 'path';

const hasName = (folder: string, name: string) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')).name === name;
  } catch {
    return false;
  }
};

/**
 * The folder of the package that `require` would find from `from`, which may be the one it is in. Looked up on the disk every time: node remembers where it found a package, which an
 * update can change.
 */
const findInstalledPackage = (from: string, name: string): string | undefined => {
  if (hasName(from, name)) return from;

  const installed = path.join(from, 'node_modules', name);
  if (fs.existsSync(path.join(installed, 'package.json'))) return installed;

  const parent = path.dirname(from);
  return parent === from ? undefined : findInstalledPackage(parent, name);
};

export default findInstalledPackage;
