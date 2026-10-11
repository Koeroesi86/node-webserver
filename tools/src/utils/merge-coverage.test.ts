import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeCoverage } from './merge-coverage';

describe('mergeCoverage', () => {
  let root: string;

  /** where jest writes a file: the absolute path on the system */
  const file = (...parts: string[]) => join(root, ...parts);

  const writeCoverage = (folder: string, coverage: object) => {
    mkdirSync(join(root, folder, 'coverage'), { recursive: true });
    writeFileSync(join(root, folder, 'coverage', 'coverage-final.json'), JSON.stringify(coverage));
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'merge-coverage-'));
    mkdirSync(join(root, 'packages', 'without-coverage'), { recursive: true });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('puts the files of every package and of tools into one map', () => {
    writeCoverage(join('packages', 'a'), { [file('packages', 'a', 'one.ts')]: {} });
    writeCoverage(join('packages', 'b'), { [file('packages', 'b', 'two.ts')]: {} });
    writeCoverage('tools', { [file('tools', 'three.ts')]: {} });

    expect(Object.keys(mergeCoverage(root)).sort()).toEqual(['packages/a/one.ts', 'packages/b/two.ts', 'tools/three.ts']);
  });

  it('skips a package that has no coverage', () => {
    writeCoverage(join('packages', 'a'), { [file('packages', 'a', 'one.ts')]: {} });

    expect(Object.keys(mergeCoverage(root))).toEqual(['packages/a/one.ts']);
  });

  it('names the file by its path from the root inside the entry as well', () => {
    writeCoverage(join('packages', 'a'), { [file('packages', 'a', 'one.ts')]: { path: file('packages', 'a', 'one.ts'), s: { 0: 1 } } });

    expect(mergeCoverage(root)['packages/a/one.ts']).toEqual({ path: 'packages/a/one.ts', s: { 0: 1 } });
  });

  it('is empty when nothing has run with coverage', () => {
    expect(mergeCoverage(root)).toEqual({});
  });
});
