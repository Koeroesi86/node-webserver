import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findNameProblems } from './find-name-problems';

const root = resolve(__dirname, '../../..');

const sourceFiles = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true })
    .filter(({ name }) => !['node_modules', 'dist', 'coverage'].includes(name))
    .flatMap((entry) => (entry.isDirectory() ? sourceFiles(join(folder, entry.name)) : [join(folder, entry.name)]));

describe('findNameProblems', () => {
  it('accepts kebab-case names with test, helper and declaration suffixes', () => {
    expect(
      findNameProblems(['src/utils/get-date.ts', 'src/utils/get-date.test.ts', 'src/utils/mock-logger.test-helper.ts', 'src/types/vhost.d.ts', 'src/index.ts'])
    ).toEqual([]);
  });

  it('finds camelCase and PascalCase names', () => {
    expect(findNameProblems(['src/utils/getDate.ts', 'src/classes/RequestEvent.ts', 'src/utils/getDate.test.ts'])).toEqual([
      'src/utils/getDate.ts: file names are kebab-case',
      'src/classes/RequestEvent.ts: file names are kebab-case',
      'src/utils/getDate.test.ts: file names are kebab-case',
    ]);
  });

  it('leaves other files alone', () => {
    expect(findNameProblems(['examples/exampleWorker.js', 'README.md'])).toEqual([]);
  });

  it('finds nothing in the sources of the workspace', () => {
    const sources = [...readdirSync(join(root, 'packages')).map((name) => join(root, 'packages', name, 'src')), join(root, 'tools/src')];
    expect(findNameProblems(sources.flatMap(sourceFiles))).toEqual([]);
  });
});
