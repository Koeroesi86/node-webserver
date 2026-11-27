import fs from 'fs';
import os from 'os';
import path from 'path';
import findInstalledPackage from './find-installed-package';

describe('findInstalledPackage', () => {
  let root: string;
  const write = (folder: string, content: string) => {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
    fs.writeFileSync(path.join(root, folder, 'package.json'), content);
  };

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'installed-')));
    write('app', '{"name":"app"}');
    write('app/node_modules/@scope/near', '{"name":"@scope/near"}');
    write('node_modules/@scope/far', '{"name":"@scope/far"}');
    write('app/broken', '{');
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it.each([
    ['in the folder', '@scope/near', 'app/node_modules/@scope/near'],
    ['in a folder above', '@scope/far', 'node_modules/@scope/far'],
    ['that it is in', 'app', 'app'],
  ])('finds a package %s', (_, name, folder) => {
    expect(findInstalledPackage(path.join(root, 'app', 'broken'), name)).toBe(path.join(root, folder));
  });

  it('finds nothing for a package that is not there', () => {
    expect(findInstalledPackage(path.join(root, 'app'), '@scope/missing')).toBeUndefined();
  });
});
