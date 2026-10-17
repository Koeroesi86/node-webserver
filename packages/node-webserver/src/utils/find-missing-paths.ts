import fs from 'fs';
import type { ConfigurationProblem } from '../types';

export interface PathEntry {
  setting: string;
  path: string | undefined;
  kind: 'file' | 'folder';
}

const exists = (path: string, kind: PathEntry['kind']) => {
  const stat = fs.statSync(path, { throwIfNoEntry: false });

  return kind === 'file' ? stat?.isFile() : stat?.isDirectory();
};

/** the entries that are set to a path where there is no file, or no folder */
const findMissingPaths = (server: string, entries: PathEntry[]): ConfigurationProblem[] =>
  entries
    .filter(({ path, kind }) => path !== undefined && !exists(path, kind))
    .map(({ setting, path, kind }) => ({ severity: 'error', server, setting, message: `is not ${kind === 'file' ? 'a file' : 'a folder'}: ${path}` }));

export default findMissingPaths;
