import fs from 'fs';
import os from 'os';
import path from 'path';
import findMissingPaths from './find-missing-paths';

describe('findMissingPaths', () => {
  let folder: string;

  beforeAll(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-paths-'));
    fs.writeFileSync(path.join(folder, 'a.js'), '');
  });

  afterAll(() => fs.rmSync(folder, { recursive: true, force: true }));

  it('finds nothing where the file and the folder are, or the setting is not set', () => {
    expect(
      findMissingPaths('s', [
        { setting: 'file', path: path.join(folder, 'a.js'), kind: 'file' },
        { setting: 'folder', path: folder, kind: 'folder' },
        { setting: 'unset', path: undefined, kind: 'file' },
      ])
    ).toEqual([]);
  });

  it('names what is not there, and what is the other one of a file and a folder', () => {
    expect(
      findMissingPaths('s', [
        { setting: 'missing', path: path.join(folder, 'b.js'), kind: 'file' },
        { setting: 'folderAsFile', path: folder, kind: 'file' },
        { setting: 'fileAsFolder', path: path.join(folder, 'a.js'), kind: 'folder' },
      ]).map(({ setting, message }) => `${setting} ${message}`)
    ).toEqual([
      `missing is not a file: ${path.join(folder, 'b.js')}`,
      `folderAsFile is not a file: ${folder}`,
      `fileAsFolder is not a folder: ${path.join(folder, 'a.js')}`,
    ]);
  });
});
