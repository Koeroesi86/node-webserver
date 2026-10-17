import fs from 'fs';
import os from 'os';
import path from 'path';
import findCertificateProblems from './find-certificate-problems';
import makeCertificate from './make-certificate.test-helper';

const DAY = 24 * 60 * 60 * 1000;

describe('findCertificateProblems', () => {
  let folder: string;
  let first: { key: string; cert: string };
  let second: { key: string; cert: string };

  beforeAll(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'certificate-problems-'));
    first = makeCertificate(folder, 'first.localhost');
    second = makeCertificate(folder, 'second.localhost');
  });

  afterAll(() => fs.rmSync(folder, { recursive: true, force: true }));

  const find = (settings: object, now?: number) =>
    findCertificateProblems({ hostname: 'a.localhost', protocol: 'https', ...settings }, 's', now).map(
      ({ severity, setting, message }) => `${severity} ${setting} ${message}`
    );

  it('finds nothing for a key and certificate that belong together and last', () => {
    expect(find(first)).toEqual([]);
  });

  it('wants a key and certificate of https, and none of http', () => {
    expect(find({})).toEqual(['error key an https server needs a key and a cert']);
    expect(find({ protocol: 'http' })).toEqual([]);
  });

  it('wants both of the key and the certificate', () => {
    expect(find({ key: first.key })).toEqual(['error cert is needed along with the other one of key and cert']);
    expect(find({ cert: first.cert })).toEqual(['error key is needed along with the other one of key and cert']);
  });

  it('leaves files that are not there to findMissingPaths', () => {
    expect(find({ key: path.join(folder, 'none.pem'), cert: first.cert })).toEqual([]);
  });

  it('finds a certificate that does not belong to the key', () => {
    expect(find({ key: first.key, cert: second.cert })).toEqual(['error cert does not belong to the key']);
  });

  it('finds files that are not PEM', () => {
    const junk = path.join(folder, 'junk.pem');
    fs.writeFileSync(junk, 'junk');

    expect(find({ key: first.key, cert: junk })).toEqual(['error cert is not a certificate in PEM format']);
    expect(find({ key: junk, cert: first.cert })).toEqual(['error key is not a private key in PEM format']);
  });

  it('finds a certificate that expired, and one that expires soon', () => {
    expect(find(first, Date.now() + 40 * DAY)[0]).toMatch(/^error cert expired on /);
    expect(find(first, Date.now() + 20 * DAY)[0]).toMatch(/^warning cert expires on /);
  });
});
