import fs from 'fs';
import os from 'os';
import path from 'path';
import readServerVersion from './read-server-version';

describe('readServerVersion', () => {
  it('is the version of the package as it is on the disk', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'version-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));

    const first = readServerVersion(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.4' }));

    expect([first, readServerVersion(root)]).toEqual(['1.2.3', '1.2.4']);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('is the one of this package by default', () => {
    expect(readServerVersion()).toBe(require('../../package.json').version);
  });
});
