import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import { ACME_USER_AGENT } from '../constants';
import acmeRequest from './acme-request';
import makeCertificate from './make-certificate.test-helper';

describe('acmeRequest', () => {
  let folder: string;
  let server: https.Server;
  let url: string;
  let cert: string;
  const seen: Array<{ method?: string; body: string; type?: string; agent?: string }> = [];

  beforeAll(async () => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'acme-request-'));
    const made = makeCertificate(folder, 'localhost');
    cert = made.cert;
    server = https.createServer({ key: fs.readFileSync(made.key), cert: fs.readFileSync(cert) }, (request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        seen.push({
          method: request.method,
          body: Buffer.concat(chunks).toString(),
          type: request.headers['content-type'],
          agent: request.headers['user-agent'],
        });
        response.writeHead(201, { 'Replay-Nonce': 'n1' });
        response.end('answer');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `https://localhost:${(server.address() as { port: number }).port}/`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it('sends the method, headers and body, and hands back the status, headers and body of the answer', async () => {
    const response = await acmeRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/jose+json' },
      body: '{"a":1}',
      ca: fs.readFileSync(cert, 'utf8'),
    });

    expect(response).toMatchObject({ status: 201, headers: { 'replay-nonce': 'n1' } });
    expect(response.body.toString()).toBe('answer');
    expect(seen.at(-1)).toEqual({ method: 'POST', body: '{"a":1}', type: 'application/jose+json', agent: ACME_USER_AGENT });
  });

  it('names itself in the User-Agent, which RFC 8555 asks for and Pebble insists on, unless the caller sets one', async () => {
    const ca = fs.readFileSync(cert, 'utf8');

    await acmeRequest(url, { ca });
    expect(seen.at(-1)?.agent).toBe(ACME_USER_AGENT);
    await acmeRequest(url, { ca, headers: { 'User-Agent': 'other' } });
    expect(seen.at(-1)?.agent).toBe('other');
  });

  it('does not trust a server whose certificate it was not given', async () => {
    await expect(acmeRequest(url)).rejects.toThrow(/self.signed|certificate/i);
  });

  it('fails on a server that is not there', async () => {
    await expect(acmeRequest('https://localhost:1/')).rejects.toThrow();
  });
});
