import { X509Certificate } from 'crypto';
import fs from 'fs';

const DAY = 24 * 60 * 60 * 1000;

const readCertificate = (file: string) => {
  try {
    return new X509Certificate(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

/** whether the file has no certificate, or one that expires within `renewBeforeDays`, by default once a third of its lifetime is left (what Let's Encrypt advises, as its certificates get shorter) */
const needsCertificate = (file: string, renewBeforeDays?: number, now = Date.now()): boolean => {
  const certificate = readCertificate(file);
  if (!certificate) return true;

  const expires = certificate.validToDate.getTime();
  const margin = renewBeforeDays === undefined ? (expires - certificate.validFromDate.getTime()) / 3 : renewBeforeDays * DAY;

  return expires - now < margin;
};

export default needsCertificate;
