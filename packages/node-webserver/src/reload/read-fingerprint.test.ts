import fs from 'fs';
import os from 'os';
import path from 'path';
import readFingerprint from './read-fingerprint';

describe('readFingerprint', () => {
  let folder: string;

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'read-fingerprint-'));
  });

  afterEach(() => {
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it('changes with the content of a file', () => {
    const file = path.join(folder, 'a.js');
    fs.writeFileSync(file, 'one');
    const before = readFingerprint([file]);
    fs.writeFileSync(file, 'two');

    expect(readFingerprint([file])).not.toBe(before);
  });

  it('changes when a link points to another folder with the same content', () => {
    ['one', 'two'].forEach((release) => {
      fs.mkdirSync(path.join(folder, release));
      fs.writeFileSync(path.join(folder, release, 'a.js'), 'same');
    });
    const link = path.join(folder, 'build');
    fs.symlinkSync(path.join(folder, 'one'), link, 'dir');
    const files = [path.join(link, 'a.js'), link];
    const before = readFingerprint(files);

    fs.rmSync(link);
    fs.symlinkSync(path.join(folder, 'two'), link, 'dir');

    expect(before).toBeDefined();
    expect(readFingerprint(files)).not.toBe(before);
  });

  it('takes a folder by its real path, without reading it', () => {
    expect(readFingerprint([folder])).toBeDefined();
  });

  it('is undefined when a file cannot be read', () => {
    expect(readFingerprint([path.join(folder, 'missing.js')])).toBeUndefined();
  });
});
