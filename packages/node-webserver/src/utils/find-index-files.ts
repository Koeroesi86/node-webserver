import fs from 'fs';
import path from 'path';

const list = (folder: string) => {
  try {
    return fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
};

/**
 * The files under the folder whose name is one of the index files of a worker server: they are the workers that its requests find without a route.
 * Links to folders are not followed, so a link back up cannot loop, and `node_modules` is left out, as its packages have index files that nothing runs as a worker.
 */
const findIndexFiles = (folder: string, names: string[]): string[] =>
  list(folder).flatMap((entry) => {
    const file = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : findIndexFiles(file, names);
    }

    return names.includes(entry.name) ? [file] : [];
  });

export default findIndexFiles;
