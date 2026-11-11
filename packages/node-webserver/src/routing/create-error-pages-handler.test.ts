import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import createErrorPagesHandler from './create-error-pages-handler';

describe('createErrorPagesHandler', () => {
  const servers: http.Server[] = [];
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'error-pages-'));
  const notFound = path.join(folder, '404.html');
  const unavailable = path.join(folder, '503.txt');

  beforeAll(() => {
    fs.writeFileSync(notFound, '<h1>Gone</h1>');
    fs.writeFileSync(unavailable, 'Back soon');
  });

  afterAll(() => fs.rmSync(folder, { recursive: true }));

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => {
        server.closeAllConnections();
        return new Promise((resolve) => server.close(resolve));
      })
    );
  });

  /** the server of the host answers with `answer`, the pages of the host are the ones given */
  const request = async (answer: express.RequestHandler, method = 'GET') => {
    const server = http.createServer(
      express()
        .use(createErrorPagesHandler({ 404: notFound, 503: unavailable }))
        .use(answer)
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      http
        .request({ port: (server.address() as { port: number }).port, method }, (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString() }));
        })
        .on('error', reject)
        .end();
    });
  };

  it('answers the status with the file, its type from the extension, and its length', async () => {
    const response = await request((req, res) => res.status(404).json({ message: 'Not Found' }));

    expect(response).toMatchObject({ status: 404, body: '<h1>Gone</h1>' });
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.headers['content-length']).toBe('13');
  });

  it('serves a file without a known extension as text, and keeps the other headers', async () => {
    const response = await request((req, res) => res.status(503).set('Retry-After', '30').type('json').send('{"message":"busy"}'));

    expect(response).toMatchObject({ status: 503, body: 'Back soon' });
    expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(response.headers['retry-after']).toBe('30');
  });

  it('replaces a body that is written with writeHead and end, in pieces', async () => {
    const response = await request((req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Content-Length': '5' });
      res.write('{"a":');
      res.end('1}');
    });

    expect(response).toMatchObject({ status: 404, body: '<h1>Gone</h1>' });
    expect(response.headers['content-length']).toBe('13');
  });

  it('leaves a status without a file, and a response that is html already', async () => {
    expect(await request((req, res) => res.status(500).send('boom'))).toMatchObject({ status: 500, body: 'boom' });
    expect(await request((req, res) => res.status(404).type('html').send('<p>mine</p>'))).toMatchObject({ status: 404, body: '<p>mine</p>' });
    expect(await request((req, res) => res.send('fine'))).toMatchObject({ status: 200, body: 'fine' });
  });

  it('sends the head of a HEAD request with the length of the file, and no body', async () => {
    const response = await request((req, res) => res.status(404).type('text').send('nope'), 'HEAD');

    expect(response).toMatchObject({ status: 404, body: '' });
    expect(response.headers['content-length']).toBe('13');
  });

  it('fails when a file is not there, so the server does not start with a page it cannot send', () => {
    expect(() => createErrorPagesHandler({ 404: path.join(folder, 'missing.html') })).toThrow('ENOENT');
  });
});
