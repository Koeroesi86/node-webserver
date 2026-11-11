import fs from 'fs';
import os from 'os';
import path from 'path';
import findLinks from './find-links';

describe('findLinks', () => {
  let folder: string;

  beforeEach(() => {
    folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'find-links-')));
  });

  afterEach(() => {
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it('finds the links on the way to a path, with the folder they are in', () => {
    fs.mkdirSync(path.join(folder, 'build.1'));
    fs.symlinkSync(path.join(folder, 'build.1'), path.join(folder, 'build'), 'dir');

    expect(findLinks(path.join(folder, 'build', 'worker.js'))).toEqual([{ folder, name: 'build' }]);
  });

  it('finds the path itself when it is a link', () => {
    fs.writeFileSync(path.join(folder, 'a.js'), 'one');
    fs.symlinkSync(path.join(folder, 'a.js'), path.join(folder, 'b.js'));

    expect(findLinks(path.join(folder, 'b.js'))).toEqual([{ folder, name: 'b.js' }]);
  });

  it('finds nothing on a path without links, also when it does not exist', () => {
    expect(findLinks(path.join(folder, 'missing', 'a.js'))).toEqual([]);
  });
});
