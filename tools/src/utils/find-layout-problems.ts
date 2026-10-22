// git lists paths with slashes on every platform, so not the separators of the platform
import { basename, dirname, join } from 'node:path/posix';
import { findNameProblems } from './find-name-problems';

const BARREL_FOLDER = /(^|\/)(utils|middlewares|classes)\/[^/]+$/;
const UTILS_FOLDER = /(^|\/)utils\/[^/]+$/;
const EXPORT = /^export /gm;

const isSource = (file: string) => file.endsWith('.ts') && !/\.(test|test-helper)\.ts$/.test(file) && basename(file) !== 'index.ts';

/**
 * what the added files break of the layout rules of CLAUDE.md: kebab-case names, an export from the `index.ts` of the folder, and in `utils/`
 * one export and a test next to the file. `read` gives the content of a file, undefined when there is none. A type counts as an export, as types belong in `types/`
 */
export const findLayoutProblems = (files: string[], read: (path: string) => string | undefined): string[] => {
  const sources = files.filter(isSource);

  return [
    ...findNameProblems(files),
    ...sources
      .filter((file) => BARREL_FOLDER.test(file))
      .filter((file) => !read(join(dirname(file), 'index.ts'))?.includes(`from './${basename(file, '.ts')}'`))
      .map((file) => `${file}: not exported by the index.ts next to it`),
    ...sources
      .filter((file) => UTILS_FOLDER.test(file))
      .flatMap((file) => [
        ...((read(file)?.match(EXPORT) ?? []).length === 1 ? [] : [`${file}: one exported function per file in utils/`]),
        ...(read(file.replace(/\.ts$/, '.test.ts')) === undefined ? [`${file}: no ${basename(file, '.ts')}.test.ts next to it`] : []),
      ]),
  ];
};
