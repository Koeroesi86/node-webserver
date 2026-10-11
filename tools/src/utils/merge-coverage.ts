import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const coverageFile = join('coverage', 'coverage-final.json');

/**
 * The coverage maps of jest in the packages (`packages/<name>/coverage/coverage-final.json`) and in `tools`, as one map.
 * The files of a package are keyed by their own path and no file is covered by two packages, so the maps do not overlap.
 */
export const mergeCoverage = (root: string): Record<string, unknown> => {
  const folders = [...readdirSync(join(root, 'packages')).map((name) => join(root, 'packages', name)), join(root, 'tools')];

  return Object.assign(
    {},
    ...folders
      .map((folder) => join(folder, coverageFile))
      .filter((file) => existsSync(file))
      .map((file) => JSON.parse(readFileSync(file, 'utf8')))
  );
};
