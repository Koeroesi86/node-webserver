import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPackages } from './read-packages';

describe('readPackages', () => {
  const folder = mkdtempSync(join(tmpdir(), 'read-packages-'));

  beforeAll(() => {
    const write = (directory: string, packageJson: object) => {
      mkdirSync(join(folder, directory));
      writeFileSync(join(folder, directory, 'package.json'), JSON.stringify(packageJson));
    };
    write('a', { name: '@scope/a', version: '1.0.0' });
    write('b', { name: '@scope/b' });
    write('private', { name: '@scope/private', private: true });
    writeFileSync(join(folder, 'README.md'), 'not a package');
  });

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('reads the packages that are not private, with where they are', () => {
    expect(readPackages(folder)).toEqual([
      { path: join(folder, 'a'), packageJsonPath: join(folder, 'a', 'package.json'), packageJson: { name: '@scope/a', version: '1.0.0' } },
      { path: join(folder, 'b'), packageJsonPath: join(folder, 'b', 'package.json'), packageJson: { name: '@scope/b' } },
    ]);
  });

  it('fails when a folder has no package.json, as the workspace is broken then', () => {
    mkdirSync(join(folder, 'broken'));

    expect(() => readPackages(folder)).toThrow();
    rmSync(join(folder, 'broken'), { recursive: true });
  });
});
