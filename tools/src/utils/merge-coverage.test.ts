import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeCoverage } from './merge-coverage';

describe('mergeCoverage', () => {
  let root: string;

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
    writeCoverage(join('packages', 'a'), { '/a/one.ts': { path: '/a/one.ts' } });
    writeCoverage(join('packages', 'b'), { '/b/two.ts': { path: '/b/two.ts' } });
    writeCoverage('tools', { '/tools/three.ts': { path: '/tools/three.ts' } });

    expect(Object.keys(mergeCoverage(root)).sort()).toEqual(['/a/one.ts', '/b/two.ts', '/tools/three.ts']);
  });

  it('skips a package that has no coverage', () => {
    writeCoverage(join('packages', 'a'), { '/a/one.ts': {} });

    expect(Object.keys(mergeCoverage(root))).toEqual(['/a/one.ts']);
  });

  it('is empty when nothing has run with coverage', () => {
    expect(mergeCoverage(root)).toEqual({});
  });
});
