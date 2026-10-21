import { resolve } from 'node:path';
import { findEntryProblems } from './find-entry-problems';
import { readPackages } from './read-packages';

describe('findEntryProblems', () => {
  it('accepts the primary entry and package.json', () => {
    expect(findEntryProblems({ name: 'a', main: 'dist/index.js', exports: { '.': './dist/index.js', './package.json': './package.json' } })).toEqual([]);
  });

  it('accepts the extra entries of the package', () => {
    expect(findEntryProblems({ name: '@koeroesi86/node-worker', exports: { '.': './dist/index.js', './pool': './dist/pool/index.js' } })).toEqual([]);
  });

  it('accepts an executable that has no importable entry', () => {
    expect(findEntryProblems({ name: 'a', bin: { a: './dist/cli.js' }, exports: { './package.json': './package.json' } })).toEqual([]);
  });

  it('finds a package without exports', () => {
    expect(findEntryProblems({ name: 'a', main: 'dist/index.js' })).toEqual(['a: no exports map, every file of the package can be imported']);
  });

  it('finds a file of the package published as an entry', () => {
    expect(findEntryProblems({ name: 'a', exports: { '.': './dist/index.js', './dist/utils/x': './dist/utils/x.js' } })).toEqual([
      'a: ./dist/utils/x is not an entry of the package (see EXTRA_ENTRIES)',
    ]);
  });

  it('finds a package that has no primary entry', () => {
    expect(findEntryProblems({ name: 'a', main: 'dist/index.js', exports: { './package.json': './package.json' } })).toEqual(['a: no primary entry (.)']);
  });

  it('finds nothing in the packages of the workspace', () => {
    expect(readPackages(resolve(__dirname, '../../../packages')).flatMap(({ packageJson }) => findEntryProblems(packageJson))).toEqual([]);
  });
});
