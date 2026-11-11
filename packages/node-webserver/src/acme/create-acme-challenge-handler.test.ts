import express from 'express';
import http from 'http';
import createAcmeChallengeHandler from './create-acme-challenge-handler';

describe('createAcmeChallengeHandler', () => {
  let server: http.Server;

  beforeAll(async () => {
    const challenges = new Map([['token-1', 'token-1.thumbprint']]);
    server = http.createServer(
      express()
        .use(createAcmeChallengeHandler(challenges))
        .use((request, response) => response.status(404).end('host'))
    );
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  const request = (path: string, method = 'GET') =>
    new Promise<{ status: number; body: string; type?: string }>((resolve, reject) => {
      http
        .request({ port: (server.address() as { port: number }).port, path, method }, (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString(), type: response.headers['content-type'] })
          );
        })
        .on('error', reject)
        .end();
    });

  it('answers the token of a challenge with its key authorization', async () => {
    expect(await request('/.well-known/acme-challenge/token-1')).toEqual({ status: 200, body: 'token-1.thumbprint', type: 'text/plain' });
  });

  it('answers it for a query string and a HEAD request too, the second without the body', async () => {
    expect((await request('/.well-known/acme-challenge/token-1?x=1')).body).toBe('token-1.thumbprint');
    expect(await request('/.well-known/acme-challenge/token-1', 'HEAD')).toMatchObject({ status: 200, body: '' });
  });

  it('passes everything else on to the hosts', async () => {
    expect((await request('/.well-known/acme-challenge/other')).body).toBe('host');
    expect((await request('/.well-known/acme-challenge/')).body).toBe('host');
    expect((await request('/index.html')).body).toBe('host');
    expect((await request('/.well-known/acme-challenge/token-1', 'POST')).body).toBe('host');
  });
});
