import fs from 'fs';
import os from 'os';
import path from 'path';
import findIndexFiles from './find-index-files';

describe('findIndexFiles', () => {
  let folder: string;

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'find-index-files-'));
  });

  afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));

  const write = (name: string) => {
    fs.mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
    fs.writeFileSync(path.join(folder, name), name);
  };

  it('finds the files with the names of the index files, in all the folders', () => {
    ['index.js', 'api/index.js', 'api/v1/main.js', 'api/other.js', 'style.css'].forEach(write);

    expect(findIndexFiles(folder, ['index.js', 'main.js']).sort()).toEqual(
      ['api/index.js', 'api/v1/main.js', 'index.js'].map((name) => path.join(folder, name)).sort()
    );
  });

  it('leaves out node_modules, and does not follow a link to a folder', () => {
    ['index.js', 'node_modules/package/index.js'].forEach(write);
    fs.symlinkSync(folder, path.join(folder, 'loop'), 'junction');

    expect(findIndexFiles(folder, ['index.js'])).toEqual([path.join(folder, 'index.js')]);
  });

  it('is empty for a folder that does not exist, or without index files', () => {
    expect(findIndexFiles(path.join(folder, 'missing'), ['index.js'])).toEqual([]);
    expect(findIndexFiles(folder, [])).toEqual([]);
  });
});
