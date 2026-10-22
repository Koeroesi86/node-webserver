import fs from 'fs';
import path from 'path';

/** a file is written next to its place and moved there, so that a reload that reads it meanwhile gets the old content or the new one, never half of it */
const replaceFile = (file: string, content: string, mode: number) => {
  const temporary = `${file}.${process.pid}.tmp`;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, content, { mode });
  fs.renameSync(temporary, file);
};

/** the key first, then the certificate: the certificate is what is looked at to see that a host has one */
const writeCertificateFiles = ({ key, cert }: { key: string; cert: string }, keyPem: string, chainPem: string) => {
  replaceFile(key, keyPem, 0o600);
  replaceFile(cert, chainPem, 0o644);
};

export default writeCertificateFiles;
