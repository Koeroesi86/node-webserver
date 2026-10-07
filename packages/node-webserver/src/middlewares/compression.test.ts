import express from 'express';
import http from 'http';
import zlib from 'zlib';
import type { RequestHandler } from 'express';
import compression, { chooseEncoding } from './compression';
import type { CompressionOptions } from '../types';

const text = 'It works! '.repeat(500);

describe('chooseEncoding', () => {
  it.each([
    ['gzip, deflate, br', ['br', 'gzip', 'deflate'], 'br'],
    ['gzip, deflate, br', ['gzip', 'br'], 'gzip'],
    ['gzip;q=0.5, br;q=0.9', ['br', 'gzip'], 'br'],
    ['gzip;q=0.9, br;q=0.5', ['br', 'gzip'], 'gzip'],
    ['gzip;q=0, deflate', ['gzip', 'deflate'], 'deflate'],
    ['*', ['br', 'gzip'], 'br'],
    ['*;q=0.1, gzip', ['br', 'gzip'], 'gzip'],
    ['GZIP', ['gzip'], 'gzip'],
    ['identity', ['gzip'], undefined],
    ['', ['gzip'], undefined],
    ['compress', ['gzip'], undefined],
    ['gzip;q=nonsense', ['gzip'], undefined],
  ] as const)('for %j with %j chooses %s', (accept, supported, expected) => {
    expect(chooseEncoding(accept, [...supported])).toBe(expected);
  });
});

describe('compression', () => {
  let server: http.Server;
  let port: number;

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const serve = async (handler: RequestHandler, options?: CompressionOptions) => {
    const app = express();
    app.disable('x-powered-by');
    app.use(compression(options));
    app.use(handler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;
  };

  const get = (acceptEncoding?: string, { method = 'GET', headers = {} as http.OutgoingHttpHeaders } = {}) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const request = http.request(
        { port, method, headers: { ...(acceptEncoding !== undefined && { 'Accept-Encoding': acceptEncoding }), ...headers } },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
        }
      );
      request.on('error', reject);
      request.end();
    });

  /** a response written the way the middleware of the workers does it: headers given to writeHead, then write and end */
  const explicit =
    (type = 'text/html', extra: Record<string, string | number> = {}): RequestHandler =>
    (request, response) => {
      response.writeHead(200, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(text), ...extra });
      response.write(text);
      response.end();
    };

  describe('what it compresses', () => {
    beforeEach(() => serve(explicit()));

    it.each([
      ['gzip', (body: Buffer) => zlib.gunzipSync(body)],
      ['br', (body: Buffer) => zlib.brotliDecompressSync(body)],
      ['deflate', (body: Buffer) => zlib.inflateSync(body)],
    ])('with %s, so that the client gets the same text and a smaller body', async (encoding, decode) => {
      const response = await get(encoding);

      expect(response.status).toBe(200);
      expect(response.headers['content-encoding']).toBe(encoding);
      expect(decode(response.body).toString()).toBe(text);
      expect(response.body.length).toBeLessThan(text.length / 5);
    });

    it('without a content length, as the compressed size is not the given one, and with Vary', async () => {
      const response = await get('gzip');

      expect(response.headers['content-length']).toBeUndefined();
      expect(response.headers['transfer-encoding']).toBe('chunked');
      expect(response.headers.vary).toBe('Accept-Encoding');
    });

    it('not for a client that accepts nothing, but with Vary for the caches', async () => {
      const withoutHeader = await get();
      const identity = await get('identity');

      [withoutHeader, identity].forEach((response) => {
        expect(response.headers['content-encoding']).toBeUndefined();
        expect(response.headers['content-length']).toBe(`${Buffer.byteLength(text)}`);
        expect(response.headers.vary).toBe('Accept-Encoding');
        expect(response.body.toString()).toBe(text);
      });
    });

    it('prefers brotli to gzip when the client likes them the same, and what the client likes more otherwise', async () => {
      expect((await get('gzip, br')).headers['content-encoding']).toBe('br');
      expect((await get('gzip, br;q=0.2')).headers['content-encoding']).toBe('gzip');
    });
  });

  describe('what it leaves alone', () => {
    it.each([
      ['an image', explicit('image/png')],
      ['a response that has an encoding', explicit('text/html', { 'Content-Encoding': 'br' })],
      ['a response that must not be transformed', explicit('text/html', { 'Cache-Control': 'public, no-transform' })],
      [
        'a response below the threshold',
        (_: unknown, response) => void response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': 100 }).end('x'.repeat(100)),
      ],
    ] as Array<[string, RequestHandler]>)('%s', async (_, handler) => {
      await serve(handler);

      const response = await get('gzip, br');

      // the body is what the handler wrote, not compressed by the middleware
      expect(response.body.toString()).toMatch(/^(It works! |x{100}$)/);
    });

    it('a HEAD request', async () => {
      await serve(explicit());

      const response = await get('gzip', { method: 'HEAD' });

      expect(response.headers['content-encoding']).toBeUndefined();
      expect(response.headers['content-length']).toBe(`${Buffer.byteLength(text)}`);
    });

    it.each([204, 304])('a %s response', async (status) => {
      await serve((_, response) => void response.writeHead(status, { 'Content-Type': 'text/html' }).end());

      expect((await get('gzip')).headers['content-encoding']).toBeUndefined();
    });

    it('does not add a Vary header for types it would not compress', async () => {
      await serve(explicit('image/png'));

      expect((await get('gzip')).headers.vary).toBeUndefined();
    });
  });

  describe('options', () => {
    it('compresses below the default threshold when it is lowered', async () => {
      await serve((_, response) => void response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': 300 }).end('a'.repeat(300)), {
        threshold: 100,
      });

      expect((await get('gzip')).headers['content-encoding']).toBe('gzip');
    });

    it('only uses the encodings that are allowed', async () => {
      await serve(explicit(), { encodings: ['gzip'] });

      expect((await get('br, gzip')).headers['content-encoding']).toBe('gzip');
      expect((await get('br')).headers['content-encoding']).toBeUndefined();
    });
  });

  describe('headers', () => {
    it('adds to the Vary header that is there', async () => {
      await serve(explicit('text/html', { Vary: 'Origin' }));

      expect((await get('gzip')).headers.vary).toBe('Origin, Accept-Encoding');
    });

    it('does not repeat Accept-Encoding in the Vary header', async () => {
      await serve(explicit('text/html', { Vary: 'accept-encoding' }));

      expect((await get('gzip')).headers.vary).toBe('accept-encoding');
    });

    it('makes a strong ETag weak, and keeps a weak one', async () => {
      await serve(explicit('text/html', { ETag: '"abc"' }));
      expect((await get('gzip')).headers.etag).toBe('W/"abc"');
      await new Promise((resolve) => server.close(resolve));

      await serve(explicit('text/html', { ETag: 'W/"abc"' }));
      expect((await get('gzip')).headers.etag).toBe('W/"abc"');
    });

    it('keeps the other headers and the status', async () => {
      await serve(
        (_, response) =>
          void response.writeHead(201, { 'Content-Type': 'application/json', 'X-Custom': 'kept', 'Content-Length': Buffer.byteLength(text) }).end(text)
      );

      const response = await get('gzip');

      expect(response.status).toBe(201);
      expect(response.headers['x-custom']).toBe('kept');
      expect(response.headers['content-type']).toBe('application/json');
    });
  });

  describe('ways of writing a response', () => {
    it('headers set before, the body ended with the first call', async () => {
      await serve((_, response) => {
        response.setHeader('Content-Type', 'text/plain');
        response.end(text);
      });

      const response = await get('gzip');

      expect(response.headers['content-encoding']).toBe('gzip');
      expect(zlib.gunzipSync(response.body).toString()).toBe(text);
    });

    it('headers set before, a body that is not known to be big enough is left alone', async () => {
      await serve((_, response) => {
        response.setHeader('Content-Type', 'text/plain');
        response.end('small');
      });

      const response = await get('gzip');

      expect(response.headers['content-encoding']).toBeUndefined();
      expect(response.body.toString()).toBe('small');
    });

    it('headers set before, the body written in parts', async () => {
      await serve((_, response) => {
        response.setHeader('Content-Type', 'text/plain');
        response.write(text.slice(0, 1000));
        response.write(text.slice(1000));
        response.end();
      });

      const response = await get('br');

      expect(response.headers['content-encoding']).toBe('br');
      expect(zlib.brotliDecompressSync(response.body).toString()).toBe(text);
    });

    it('a body that is a stream of unknown size', async () => {
      await serve((_, response) => {
        response.setHeader('Content-Type', 'text/plain');
        response.write('first ');
        response.end('second');
      });

      const response = await get('gzip');

      expect(zlib.gunzipSync(response.body).toString()).toBe('first second');
    });

    it('lets a streamed response reach the client while it is produced', async () => {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => (release = resolve));
      await serve((_, response) => {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.write('first part');
        released.then(() => response.end(' second part'));
      });

      const received = await new Promise<string>((resolve, reject) => {
        const decoder = zlib.createGunzip();
        const request = http.get({ port, headers: { 'Accept-Encoding': 'gzip' } }, (response) => {
          response.pipe(decoder);
          decoder.once('data', (chunk) => {
            // the response is not over, and the first part is there already
            resolve(chunk.toString());
            release();
          });
        });
        request.on('error', reject);
      });

      expect(received).toBe('first part');
    });

    it('a big body, with a client that reads slowly', async () => {
      const big = Buffer.from('0123456789abcdef'.repeat(2 * 1024 * 1024));
      await serve((_, response) => void response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': big.length }).end(big));

      const response = await get('gzip');

      expect(zlib.gunzipSync(response.body).equals(big)).toBe(true);
    });
  });
});
