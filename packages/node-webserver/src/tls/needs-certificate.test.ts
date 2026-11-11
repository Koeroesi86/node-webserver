import fs from 'fs';
import os from 'os';
import path from 'path';
import makeCertificate from './make-certificate.test-helper';
import needsCertificate from './needs-certificate';

const DAY = 24 * 60 * 60 * 1000;

describe('needsCertificate', () => {
  let folder: string;
  let cert: string;

  beforeAll(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'needs-certificate-'));
    // valid for 30 days
    ({ cert } = makeCertificate(folder, 'a.localhost'));
  });

  afterAll(() => fs.rmSync(folder, { recursive: true, force: true }));

  it('needs one where there is none, or no certificate', () => {
    expect(needsCertificate(path.join(folder, 'missing.pem'))).toBe(true);
    fs.writeFileSync(path.join(folder, 'broken.pem'), 'not a certificate');
    expect(needsCertificate(path.join(folder, 'broken.pem'))).toBe(true);
  });

  it('leaves a certificate that has more than a third of its lifetime left', () => {
    expect(needsCertificate(cert)).toBe(false);
    expect(needsCertificate(cert, undefined, Date.now() + 19 * DAY)).toBe(false);
  });

  it('wants a new one for the last third of the lifetime, and for an expired one', () => {
    expect(needsCertificate(cert, undefined, Date.now() + 21 * DAY)).toBe(true);
    expect(needsCertificate(cert, undefined, Date.now() + 60 * DAY)).toBe(true);
  });

  it('goes by the days it was given instead', () => {
    expect(needsCertificate(cert, 5, Date.now() + 20 * DAY)).toBe(false);
    expect(needsCertificate(cert, 5, Date.now() + 26 * DAY)).toBe(true);
    expect(needsCertificate(cert, 365)).toBe(true);
  });
});
