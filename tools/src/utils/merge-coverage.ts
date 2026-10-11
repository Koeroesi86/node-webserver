import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const coverageFile = join('coverage', 'coverage-final.json');

/** the path of a file relative to the root and with slashes, so that it means the same on every system: fallow puts the root in front of it */
const toRelative = (root: string, file: string) => relative(root, file).split(sep).join('/');

/**
 * The coverage maps of jest in the packages (`packages/<name>/coverage/coverage-final.json`) and in `tools`, as one map.
 * The files are keyed by their path from the root, as jest writes absolute ones that differ between systems. No file is covered by two packages, so the maps do not overlap.
 */
export const mergeCoverage = (root: string): Record<string, unknown> => {
  const folders = [...readdirSync(join(root, 'packages')).map((name) => join(root, 'packages', name)), join(root, 'tools')];

  const maps: Record<string, object>[] = folders
    .map((folder) => join(folder, coverageFile))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')));

  return Object.fromEntries(
    maps.flatMap((map) =>
      Object.entries(map).map(([file, coverage]) => {
        const path = toRelative(root, file);
        return [path, { ...coverage, path }];
      })
    )
  );
};
