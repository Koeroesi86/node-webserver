import { X509Certificate, createPrivateKey } from 'crypto';
import type { KeyObject } from 'crypto';
import fs from 'fs';
import { CERTIFICATE_EXPIRY_WARNING_DAYS } from '../constants';
import type { ConfigurationProblem, ServerConfig } from '../types';

const DAY = 24 * 60 * 60 * 1000;

const attempt = <T>(build: () => T): T | undefined => {
  try {
    return build();
  } catch {
    return undefined;
  }
};

/** read at once instead of looked at first, a file that is not there (or is a folder) is for `findMissingPaths` to name */
const readIfFile = (file: string) => attempt(() => fs.readFileSync(file, 'utf8'));

const findExpiryProblems = (server: string, { validToDate }: X509Certificate, now: number): ConfigurationProblem[] => {
  const left = validToDate.getTime() - now;

  if (left < 0) return [{ severity: 'error', server, setting: 'cert', message: `expired on ${validToDate.toISOString()}` }];
  if (left < CERTIFICATE_EXPIRY_WARNING_DAYS * DAY)
    return [{ severity: 'warning', server, setting: 'cert', message: `expires on ${validToDate.toISOString()}` }];

  return [];
};

const findPairProblems = (server: string, certificate: X509Certificate | undefined, key: KeyObject | undefined, now: number): ConfigurationProblem[] => {
  if (!certificate) return [{ severity: 'error', server, setting: 'cert', message: 'is not a certificate in PEM format' }];
  if (!key) return [{ severity: 'error', server, setting: 'key', message: 'is not a private key in PEM format' }];

  const mismatch: ConfigurationProblem[] = certificate.checkPrivateKey(key)
    ? []
    : [{ severity: 'error', server, setting: 'cert', message: 'does not belong to the key' }];

  return [...mismatch, ...findExpiryProblems(server, certificate, now)];
};

/** what is wrong with the key and certificate of a server: one of them missing, not matching, expired or about to be. The files being there is a matter of `findMissingPaths`. */
const findCertificateProblems = ({ protocol, key, cert }: ServerConfig, server: string, now = Date.now()): ConfigurationProblem[] => {
  if (!key && !cert) {
    return protocol === 'https' ? [{ severity: 'error', server, setting: 'key', message: 'an https server needs a key and a cert' }] : [];
  }

  if (!key || !cert) {
    return [{ severity: 'error', server, setting: key ? 'cert' : 'key', message: 'is needed along with the other one of key and cert' }];
  }

  const keyPem = readIfFile(key);
  const certPem = readIfFile(cert);

  if (keyPem === undefined || certPem === undefined) return [];

  return findPairProblems(
    server,
    attempt(() => new X509Certificate(certPem)),
    attempt(() => createPrivateKey(keyPem)),
    now
  );
};

export default findCertificateProblems;
