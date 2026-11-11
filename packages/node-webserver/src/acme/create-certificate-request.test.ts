import { generateKeyPairSync } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import createCertificateRequest from './create-certificate-request';

describe('createCertificateRequest', () => {
  let folder: string;

  beforeAll(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'certificate-request-'));
  });

  afterAll(() => fs.rmSync(folder, { recursive: true, force: true }));

  /** what openssl makes of the request: it checks the signature and the structure, and prints the subject and names */
  const inspect = (hostname: string) => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const file = path.join(folder, 'request.pem');
    fs.writeFileSync(
      file,
      `-----BEGIN CERTIFICATE REQUEST-----\n${createCertificateRequest(hostname, privateKey, publicKey)
        .toString('base64')
        .replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE REQUEST-----\n`
    );
    const result = spawnSync('openssl', ['req', '-in', file, '-noout', '-verify', '-text'], {
      encoding: 'utf8',
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    });

    return { status: result.status, output: `${result.stdout}${result.stderr}`, publicKey };
  };

  it('is a request openssl verifies, for the host name as the subject and the alternative name', () => {
    const { status, output } = inspect('secure.example.com');

    expect(status).toBe(0);
    expect(output).toMatch(/verif(y|ication) (OK|ok)/i);
    expect(output).toMatch(/Subject:.*CN\s?=\s?secure\.example\.com/);
    expect(output).toContain('DNS:secure.example.com');
    expect(output).toContain('ecdsa-with-SHA256');
  });

  it('puts a name that is too long for a common name in the alternative name only', () => {
    const hostname = `${'a'.repeat(60)}.example.com`;
    const { status, output } = inspect(hostname);

    expect(status).toBe(0);
    expect(output).toContain(`DNS:${hostname}`);
    expect(output).not.toMatch(/CN\s?=/);
  });
});
