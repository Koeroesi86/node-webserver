import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import createMisdirectedHandler from './create-misdirected-handler';
import type { AddressInfo } from 'net';

describe('createMisdirectedHandler', () => {
  let folder: string;
  let server: http.Server;

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'misdirected-'));
  });

  afterEach(async () => {
    fs.rmSync(folder, { recursive: true, force: true });
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
  });

  const get = async (handler: ReturnType<typeof createMisdirectedHandler>) => {
    server = http.createServer(express().use(handler));
    await new Promise<void>((resolve) => server.listen(0, resolve));

    return new Promise<{ status: number; type: string | undefined; body: string }>((resolve, reject) => {
      http
        .get({ port: (server.address() as AddressInfo).port }, (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, type: response.headers['content-type'], body: Buffer.concat(chunks).toString() })
          );
        })
        .on('error', reject);
    });
  };

  it('answers with a plain text without a page', async () => {
    expect(await get(createMisdirectedHandler())).toEqual({ status: 421, type: 'text/plain; charset=utf-8', body: 'Misdirected Request' });
  });

  it('answers with the page, of the type its extension tells', async () => {
    const page = path.join(folder, 'unknown.html');
    fs.writeFileSync(page, '<p>no such site</p>');

    expect(await get(createMisdirectedHandler(page))).toEqual({ status: 421, type: 'text/html; charset=utf-8', body: '<p>no such site</p>' });
  });

  it('throws for a page that is not there, so that a reload keeps the servers that run', () => {
    expect(() => createMisdirectedHandler(path.join(folder, 'missing.html'))).toThrow();
  });
});
