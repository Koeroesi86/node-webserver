import fs from 'fs';
import os from 'os';
import path from 'path';
import loadAcmeAccountKey from './load-acme-account-key';

describe('loadAcmeAccountKey', () => {
  let folder: string;

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'acme-account-'));
  });

  afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));

  it('makes a P-256 key in a folder that is not there yet, and finds the same one again', () => {
    const storagePath = path.join(folder, 'nested', 'acme');

    const first = loadAcmeAccountKey(storagePath, 'https://acme.example/dir');
    const second = loadAcmeAccountKey(storagePath, 'https://acme.example/dir');

    expect(first.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
    expect(second.export({ type: 'pkcs8', format: 'pem' })).toBe(first.export({ type: 'pkcs8', format: 'pem' }));
  });

  it('keeps an account for each directory, as an account belongs to one authority', () => {
    const production = loadAcmeAccountKey(folder, 'https://acme.example/dir');
    const staging = loadAcmeAccountKey(folder, 'https://staging.acme.example/dir');

    expect(staging.export({ type: 'pkcs8', format: 'pem' })).not.toBe(production.export({ type: 'pkcs8', format: 'pem' }));
    expect(fs.readdirSync(folder).filter((file) => file.startsWith('account-'))).toHaveLength(2);
  });
});
