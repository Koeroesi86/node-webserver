import { createHash, createPrivateKey, generateKeyPairSync } from 'crypto';
import type { KeyObject } from 'crypto';
import fs from 'fs';
import path from 'path';

/** the error is of another realm in the tests, so it is not told by its class */
const ignoreMissing = (error: unknown) => {
  if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') return undefined;
  throw error;
};

const readIfThere = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    return ignoreMissing(error);
  }
};

/** the account key of the ACME server, made on the first order and kept in the folder, one per directory as an account belongs to one authority */
const loadAcmeAccountKey = (storagePath: string, directory: string): KeyObject => {
  const file = path.join(storagePath, `account-${createHash('sha256').update(directory).digest('hex').slice(0, 16)}.pem`);

  // reading and handling the missing file avoids a check that the file can outlive before it is read
  const existing = readIfThere(file);
  if (existing) return createPrivateKey(existing);

  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  fs.mkdirSync(storagePath, { recursive: true });
  fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

  return privateKey;
};

export default loadAcmeAccountKey;
