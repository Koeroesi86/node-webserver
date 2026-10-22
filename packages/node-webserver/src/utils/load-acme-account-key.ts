import { createHash, createPrivateKey, generateKeyPairSync } from 'crypto';
import type { KeyObject } from 'crypto';
import fs from 'fs';
import path from 'path';

/** the account key of the ACME server, made on the first order and kept in the folder, one per directory as an account belongs to one authority */
const loadAcmeAccountKey = (storagePath: string, directory: string): KeyObject => {
  const file = path.join(storagePath, `account-${createHash('sha256').update(directory).digest('hex').slice(0, 16)}.pem`);

  if (fs.existsSync(file)) return createPrivateKey(fs.readFileSync(file, 'utf8'));

  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  fs.mkdirSync(storagePath, { recursive: true });
  fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

  return privateKey;
};

export default loadAcmeAccountKey;
