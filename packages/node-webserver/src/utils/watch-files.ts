import fs from 'fs';
import path from 'path';

/** the real path of the folder, so that a folder reached through a link (the temporary folder of macOS is one) is watched once, not twice */
const realFolder = (folder: string) => {
  try {
    return fs.realpathSync(folder);
  } catch {
    return folder;
  }
};

/**
 * Calls `onChange` when one of the files is written, created, removed or replaced, and returns the function that stops watching.
 * The folders are watched, not the files, as an editor that saves a file by replacing it would end the watcher of the file.
 */
const watchFiles = (files: string[], onChange: () => void): (() => void) => {
  const folders = files.reduce((result, file) => {
    const folder = realFolder(path.dirname(path.resolve(file)));
    result.set(folder, (result.get(folder) ?? new Set<string>()).add(path.basename(file)));
    return result;
  }, new Map<string, Set<string>>());

  const watchers = Array.from(folders).flatMap(([folder, names]) => {
    try {
      // not persistent: watching alone must not keep the process running
      const watcher = fs.watch(folder, { persistent: false }, (event, name) => (!name || names.has(name.toString()) ? onChange() : undefined));
      // a folder that is removed while it is watched ends its watcher with an error, which is no reason to stop the server
      watcher.on('error', () => watcher.close());
      return [watcher];
    } catch {
      // a folder that does not exist has nothing to watch
      return [];
    }
  });

  return () => watchers.forEach((watcher) => watcher.close());
};

export default watchFiles;
