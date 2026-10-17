import { spawnSync } from 'child_process';
import path from 'path';

/** the files of a self signed certificate of the host, made with openssl as node cannot make one */
const makeCertificate = (folder: string, hostname = 'secure.localhost') => {
  const key = path.join(folder, `${hostname}.key.pem`);
  const cert = path.join(folder, `${hostname}.cert.pem`);
  const made = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '30',
      '-subj',
      `/CN=${hostname}`,
      '-addext',
      `subjectAltName=DNS:${hostname}`,
      '-keyout',
      key,
      '-out',
      cert,
    ],
    // Git Bash on Windows would turn the subject into a path
    { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, encoding: 'utf8' }
  );
  if (made.status !== 0) throw new Error(`openssl could not make a certificate: ${made.stderr}`);

  return { key, cert };
};

export default makeCertificate;
