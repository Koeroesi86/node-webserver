import { generateKeyPairSync } from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import createAcmeClient from './create-acme-client';
import startFakeAcmeServer from './fake-acme-server.test-helper';
import type { FakeAcmeServer } from './fake-acme-server.test-helper';

describe('createAcmeClient', () => {
  let folder: string;
  let authority: FakeAcmeServer;

  beforeAll(async () => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'acme-client-'));
    authority = await startFakeAcmeServer(folder, () => 0);
  });

  afterAll(async () => {
    await authority.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  });

  beforeEach(() => authority.requests.splice(0));

  const client = () =>
    createAcmeClient({
      directoryUrl: authority.directory,
      accountKey: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey,
      ca: fs.readFileSync(authority.ca, 'utf8'),
    });

  it('reads the directory and signs for the account it registered', async () => {
    const acme = await client();
    await acme.register('admin@example.com');
    const { headers } = await acme.postJson<{ authorizations: string[] }>(acme.directory.newOrder, { identifiers: [{ type: 'dns', value: 'a.example.com' }] });

    expect(acme.thumbprint).toMatch(/^[\w-]{43}$/);
    expect(headers.location).toContain('/order/');
  });

  it('sends the request again with the new nonce when the server forgot the one it used', async () => {
    const acme = await client();
    await acme.register('admin@example.com');
    authority.requests.splice(0);
    // the server knows no nonce of the client any more: the first request of the next call fails with badNonce
    authority.forgetNonces();

    await acme.postJson(acme.directory.newOrder, { identifiers: [{ type: 'dns', value: 'b.example.com' }] });

    expect(authority.requests.filter((request) => request.startsWith('POST /new-order'))).toHaveLength(2);
  });

  it('fails with the type and detail of what the server said', async () => {
    const acme = await client();
    await acme.register('admin@example.com');

    await expect(acme.postJson(`${acme.directory.newOrder.replace('new-order', 'order/unknown')}`)).rejects.toThrow(
      /answered 404 urn:ietf:params:acme:error:malformed: no such resource/
    );
  });

  it('fails on a directory that does not answer', async () => {
    const server = http.createServer((request, response) => response.writeHead(500).end());
    await new Promise<void>((resolve) => server.listen(0, resolve));

    await expect(
      createAcmeClient({
        directoryUrl: `https://localhost:${(server.address() as { port: number }).port}/directory`,
        accountKey: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey,
      })
    ).rejects.toThrow();
    await new Promise((resolve) => server.close(resolve));
  });
});
