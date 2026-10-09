import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCommandAvailable } from './is-command-available';
import { makeCertificate } from './make-certificate';

describe('makeCertificate', () => {
  let folder = '';

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'make-certificate-'));
  });

  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('keeps a certificate that exists', () => {
    writeFileSync(join(folder, 'privkey.pem'), 'key');
    writeFileSync(join(folder, 'cert.pem'), 'certificate');

    expect(makeCertificate(folder)).toBe(true);
  });

  (isCommandAvailable('openssl', ['version']) ? it : it.skip)('makes one with openssl in a folder that does not exist yet', () => {
    const directory = join(folder, 'localhost');

    expect(makeCertificate(directory)).toBe(true);
    expect(existsSync(join(directory, 'privkey.pem'))).toBe(true);
    expect(existsSync(join(directory, 'cert.pem'))).toBe(true);
  });
});
