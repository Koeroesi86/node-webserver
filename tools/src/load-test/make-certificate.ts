import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** the self signed certificate of secure.localhost for the HTTPS routes, false when there is none and openssl cannot make it */
export const makeCertificate = (directory: string) => {
  const [key, certificate] = ['privkey.pem', 'cert.pem'].map((name) => join(directory, name));
  if (existsSync(key) && existsSync(certificate)) return true;
  mkdirSync(directory, { recursive: true });

  return (
    spawnSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=secure.localhost',
        '-addext',
        'subjectAltName=DNS:secure.localhost',
        '-keyout',
        key,
        '-out',
        certificate,
      ],
      // Git Bash on Windows would turn the subject into a path
      { stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }
    ).status === 0
  );
};
