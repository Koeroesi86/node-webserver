import fs from 'fs';
import os from 'os';
import path from 'path';
import writeCertificateFiles from './write-certificate-files';

// windows has no mode for the owner only
const unixIt = process.platform === 'win32' ? it.skip : it;

describe('writeCertificateFiles', () => {
  let folder: string;

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'write-certificate-'));
  });

  afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));

  it('writes the files, also into a folder that is not there, and leaves nothing else behind', () => {
    const files = { key: path.join(folder, 'host', 'privkey.pem'), cert: path.join(folder, 'host', 'fullchain.pem') };

    writeCertificateFiles(files, 'key', 'chain');
    writeCertificateFiles(files, 'new key', 'new chain');

    expect(fs.readFileSync(files.key, 'utf8')).toBe('new key');
    expect(fs.readFileSync(files.cert, 'utf8')).toBe('new chain');
    expect(fs.readdirSync(path.join(folder, 'host')).sort()).toEqual(['fullchain.pem', 'privkey.pem']);
  });

  unixIt('keeps the key to its owner', () => {
    const files = { key: path.join(folder, 'privkey.pem'), cert: path.join(folder, 'fullchain.pem') };

    writeCertificateFiles(files, 'key', 'chain');

    expect(fs.statSync(files.key).mode & 0o077).toBe(0);
  });
});
