import fs from 'fs';
import path from 'path';

const isLink = (target: string) => {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
};

/** the folder and the name of every link on the way to the path, so that a link that is made to point elsewhere can be told from the folder it is in */
const findLinks = (file: string): { folder: string; name: string }[] => {
  const parts = path.resolve(file).split(path.sep);

  return parts
    .map((name, index) => ({ name, target: parts.slice(0, index + 1).join(path.sep) || path.sep }))
    .filter(({ name, target }) => name !== '' && isLink(target))
    .map(({ name, target }) => ({ folder: path.dirname(target), name }));
};

export default findLinks;
