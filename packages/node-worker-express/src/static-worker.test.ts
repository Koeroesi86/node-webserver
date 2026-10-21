import type { HandOffEvent, InvokableWorker, ResponseEvent, WorkerRequestEvent } from '@koeroesi86/node-worker/pool';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { StaticOptionsEnv, StaticStreamThreshold } from './constants';
import staticWorker from './static-worker';
import type { StaticOptions } from './types';

jest.mock('./utils/get-charset', () => ({ __esModule: true, default: jest.fn().mockResolvedValue('utf-8') }));

/** the static worker only sends single values */
const withSingleValues = ({ headers = {}, ...response }: ResponseEvent | HandOffEvent) => ({
  ...response,
  headers: Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, `${value}`])),
});

describe('staticWorker', () => {
  let parent: string;
  let root: string;
  let big: Buffer;

  beforeAll(async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'hrtime'] });
    parent = await fs.mkdtemp(path.join(os.tmpdir(), 'static-worker-'));
    root = path.join(parent, 'root');
    big = crypto.randomBytes(StaticStreamThreshold * 6 + 12345);
    await fs.mkdir(path.join(root, 'sub'), { recursive: true });
    await fs.writeFile(path.join(root, 'index.html'), '<h1>home</h1>');
    await fs.writeFile(path.join(root, 'a..b.txt'), 'dots');
    await fs.writeFile(path.join(root, 'a b%c.txt'), 'encoded');
    await fs.writeFile(path.join(root, 'árvíztűrő.txt'), 'unicode');
    await fs.writeFile(path.join(root, 'big.bin'), big);
    await fs.writeFile(path.join(root, 'icon.ico'), Buffer.from([1, 2, 3]));
    await fs.writeFile(path.join(root, 'digits.txt'), '0123456789');
    await fs.mkdir(path.join(root, 'assets'));
    await fs.writeFile(path.join(root, 'assets', 'app.js'), 'console.log(1);');
    await fs.writeFile(path.join(root, 'assets', 'app.js.br'), 'brotli bytes');
    await fs.writeFile(path.join(root, 'assets', 'app.js.gz'), 'gzip bytes');
    await fs.writeFile(path.join(root, 'assets', 'plain.css'), 'a{}');
    await fs.mkdir(path.join(root, 'listed', 'inner'), { recursive: true });
    await fs.writeFile(path.join(root, 'listed', "b & 'c'.txt"), 'b');
    await fs.writeFile(path.join(root, 'listed', 'a.txt'), 'a');
    await fs.writeFile(path.join(root, 'listed', '.hidden'), 'secret');
    await fs.mkdir(path.join(root, 'withIndex'));
    await fs.writeFile(path.join(root, 'withIndex', 'index.html'), 'index');
    await fs.writeFile(path.join(parent, 'secret.txt'), 'classified content');
  });

  afterAll(async () => {
    jest.useRealTimers();
    await fs.rm(parent, { recursive: true, force: true });
  });

  const event = (requestPath: string, httpMethod = 'GET', headers: Record<string, string> = {}) =>
    ({ httpMethod, path: requestPath, rootPath: root, headers }) as WorkerRequestEvent;

  /** the first response of the worker */
  const request = (requestPath: string, httpMethod = 'GET', headers: Record<string, string> = {}) =>
    new Promise<ResponseEvent & { headers: Record<string, string> }>((resolve) => {
      staticWorker(event(requestPath, httpMethod, headers), (response) => resolve(withSingleValues(response)));
    });
  const bodyOf = ({ body }: ResponseEvent) => `${body ?? ''}`;

  it('serves a file', async () => {
    const response = await request('/index.html');

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toBe('<h1>home</h1>');
    // the bytes of the file as they are, not a base64 string that the server would have to decode
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.headers).toMatchObject({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': '13' });
  });

  it('serves the index file of a path ending with a slash', async () => {
    expect((await request('/')).statusCode).toBe(200);
  });

  it('serves file names containing dots', async () => {
    expect(bodyOf(await request('/a..b.txt'))).toBe('dots');
  });

  it('does not name a charset for binary files', async () => {
    expect((await request('/icon.ico')).headers['Content-Type']).toBe('image/vnd.microsoft.icon');
  });

  it('answers a directory with 404 instead of failing', async () => {
    expect((await request('/sub')).statusCode).toBe(404);
  });

  it('answers a missing file with 404', async () => {
    expect((await request('/missing.html')).statusCode).toBe(404);
  });

  it('serves a file whose name is percent-encoded in the path', async () => {
    expect(bodyOf(await request('/a%20b%25c.txt'))).toBe('encoded');
    expect(bodyOf(await request('/%C3%A1rv%C3%ADzt%C5%B1r%C5%91.txt'))).toBe('unicode');
    // the name is not decoded twice
    expect((await request('/a%2520b%25c.txt')).statusCode).toBe(404);
  });

  it.each(['/%zz', '/100%', '/a%20b%25c.txt%', '/%E0%A4%A'])('answers the malformed escape in %s with 404', async (requestPath) => {
    expect((await request(requestPath)).statusCode).toBe(404);
  });

  it.each(['/%2e%2e/secret.txt', '/%2E%2E%2Fsecret.txt', '/sub/%2e%2e/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%5csecret.txt', '/%00'])(
    'does not serve files outside of the root through the encoded %s',
    async (requestPath) => {
      expect((await request(requestPath)).statusCode).toBe(404);
    }
  );

  it.each(['/../secret.txt', '/sub/../../secret.txt', '/....//secret.txt'])('does not serve files outside of the root through %s', async (requestPath) => {
    const response = await request(requestPath);

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('classified');
  });

  it('does not serve other methods than GET and HEAD', async () => {
    expect((await request('/index.html', 'POST')).statusCode).toBe(404);
  });

  it('reads a small file only once while it does not change', async () => {
    await fs.writeFile(path.join(root, 'cached.txt'), 'cached');
    await request('/cached.txt');
    const readFile = jest.spyOn(fs, 'readFile');

    expect(bodyOf(await request('/cached.txt'))).toBe('cached');
    expect(readFile).not.toHaveBeenCalled();
    readFile.mockRestore();
  });

  it('serves the new content of a small file that changed between two requests', async () => {
    const file = path.join(root, 'changing.txt');
    await fs.writeFile(file, 'before');
    expect(bodyOf(await request('/changing.txt'))).toBe('before');

    await fs.writeFile(file, 'after the change');
    const response = await request('/changing.txt');

    expect(bodyOf(response)).toBe('after the change');
    expect(response.headers['Content-Length']).toBe('16');
  });

  describe('conditional requests', () => {
    it('answers 304 without a body for the ETag it sent', async () => {
      const { headers } = await request('/index.html');

      const response = await request('/index.html', 'GET', { 'if-none-match': headers.ETag });

      expect(response.statusCode).toBe(304);
      expect(response.body).toBe('');
      expect(response.headers['Content-Length']).toBeUndefined();
    });

    it('answers 304 for a later If-Modified-Since', async () => {
      const { headers } = await request('/index.html');

      expect((await request('/index.html', 'GET', { 'if-modified-since': headers['Last-Modified'] })).statusCode).toBe(304);
    });

    it('answers 200 for another ETag even if the date matches', async () => {
      const { headers } = await request('/index.html');

      expect((await request('/index.html', 'GET', { 'if-none-match': '"other"', 'if-modified-since': headers['Last-Modified'] })).statusCode).toBe(200);
    });

    it('does not read the file for a 304', async () => {
      const { headers } = await request('/index.html');
      const readFile = jest.spyOn(fs, 'readFile');

      await request('/index.html', 'GET', { 'if-none-match': headers.ETag });

      expect(readFile).not.toHaveBeenCalled();
      readFile.mockRestore();
    });

    it('answers HEAD with the headers only, also for a big file', async () => {
      const response = await request('/big.bin', 'HEAD');

      expect(response).toMatchObject({ statusCode: 200, body: '', headers: { 'Content-Length': String(big.length) } });
      expect(response.emit).toBeUndefined();
    });
  });

  describe('big files', () => {
    /** collects the parts, `acknowledge` decides what the promise of each part resolves to */
    const stream = async (acknowledge: (part: number) => Promise<unknown> | unknown = () => true) => {
      const parts: ResponseEvent[] = [];
      await staticWorker(event('/big.bin'), (part) => {
        // the server keeps the connection, the body passes through it
        if ('handOff' in part) return Promise.resolve(undefined);
        parts.push(part);
        return Promise.resolve(acknowledge(parts.length));
      });

      return parts;
    };

    it('streams the file in parts that make up its content', async () => {
      const parts = await stream();

      expect(parts.length).toBeGreaterThan(2);
      expect(parts.every(({ emit }) => emit)).toBe(true);
      expect(parts[0]).toMatchObject({ statusCode: 200, headers: { 'Content-Length': String(big.length) } });
      expect(parts[parts.length - 1].body).toBeNull();
      expect(Buffer.concat(parts.map(({ body }) => body).filter(Buffer.isBuffer)).equals(big)).toBe(true);
    });

    it('does not send more bytes than the window allows before they are acknowledged', async () => {
      const pending: Array<() => void> = [];
      let sent = 0;
      // file reads take as long as the machine needs, so the worker has to be quiet for a while on a real clock before it is known to wait
      const settle = async (quietMilliseconds: number) => {
        let previous = -1;
        let since = process.hrtime.bigint();
        while (process.hrtime.bigint() - since < BigInt(quietMilliseconds) * 1_000_000n) {
          since = sent === previous ? since : process.hrtime.bigint();
          previous = sent;
          await new Promise((resolve) => setImmediate(resolve));
        }
      };
      const done = staticWorker(event('/big.bin'), (part) => {
        if ('handOff' in part) return Promise.resolve(undefined);
        sent += 1;
        return new Promise((resolve) => pending.push(() => resolve(true)));
      });

      await settle(150);
      // 4 MiB in parts of 1 MiB
      expect(sent).toBe(4);

      while (pending.length > 0) {
        pending.shift()();
        await settle(40);
      }
      await done;

      expect(sent).toBeGreaterThan(4);
    });

    it('keeps the bytes waiting for the client within the window for the whole file', async () => {
      let outstanding = 0;
      let peak = 0;
      let total = 0;

      await staticWorker(event('/big.bin'), (part) => {
        const size = 'body' in part && Buffer.isBuffer(part.body) ? part.body.length : 0;
        outstanding += size;
        total += size;
        peak = Math.max(peak, outstanding);
        return new Promise((resolve) =>
          setImmediate(() => {
            outstanding -= size;
            resolve(true);
          })
        );
      });

      expect(total).toBe(big.length);
      // 4 MiB window, and the part that crosses it
      expect(peak).toBeLessThanOrEqual(4 * 1024 * 1024 + 1024 * 1024);
    });

    it('stops reading when the client is gone', async () => {
      const parts = await stream((part) => part < 1);

      // the answer to the 1st part is the first no, it is read once the window is full, so the rest of the file is not sent
      const all = await stream();
      expect(parts.length).toBeLessThan(all.length - 2);
      expect(parts[parts.length - 1].body).not.toBeNull();
    });
  });

  describe('range requests', () => {
    const ranged = (requestPath: string, range: string, headers: Record<string, string> = {}) => request(requestPath, 'GET', { range, ...headers });

    it('announces that it takes ranges', async () => {
      expect((await request('/digits.txt')).headers['Accept-Ranges']).toBe('bytes');
    });

    it.each([
      ['start and end', 'bytes=2-4', '234', 'bytes 2-4/10'],
      ['an open end', 'bytes=7-', '789', 'bytes 7-9/10'],
      ['a suffix', 'bytes=-3', '789', 'bytes 7-9/10'],
      ['a suffix longer than the file', 'bytes=-50', '0123456789', 'bytes 0-9/10'],
      ['an end beyond the file', 'bytes=8-50', '89', 'bytes 8-9/10'],
    ])('answers %s with 206 from a cached file', async (_, range, expected, contentRange) => {
      await request('/digits.txt');
      const response = await ranged('/digits.txt', range);

      expect(response.statusCode).toBe(206);
      expect(bodyOf(response)).toBe(expected);
      expect(response.headers).toMatchObject({ 'Content-Range': contentRange, 'Content-Length': String(expected.length) });
    });

    it.each(['bytes=10-', 'bytes=20-30', 'bytes=-0'])('answers %s, which is outside of the file, with 416', async (range) => {
      const response = await ranged('/digits.txt', range);

      expect(response).toMatchObject({ statusCode: 416, body: '', headers: { 'Content-Range': 'bytes */10', 'Content-Length': '0' } });
    });

    it.each([
      ['several ranges', 'bytes=0-1,4-5'],
      ['another unit', 'items=0-1'],
      ['a start after the end', 'bytes=5-2'],
      ['nonsense', 'bytes=a-b'],
    ])('sends the whole file for %s', async (_, range) => {
      const response = await ranged('/digits.txt', range);

      expect(response.statusCode).toBe(200);
      expect(bodyOf(response)).toBe('0123456789');
    });

    it('uses the range when If-Range has the ETag of the file', async () => {
      const { headers } = await request('/digits.txt');

      expect((await ranged('/digits.txt', 'bytes=0-1', { 'if-range': headers.ETag })).statusCode).toBe(206);
      expect((await ranged('/digits.txt', 'bytes=0-1', { 'if-range': headers['Last-Modified'] })).statusCode).toBe(206);
    });

    it('sends the whole file when If-Range is not the one of the file', async () => {
      const response = await ranged('/digits.txt', 'bytes=0-1', { 'if-range': '"other"' });

      expect(response.statusCode).toBe(200);
      expect(bodyOf(response)).toBe('0123456789');
      expect((await ranged('/digits.txt', 'bytes=0-1', { 'if-range': 'Thu, 01 Jan 1970 00:00:00 GMT' })).statusCode).toBe(200);
    });

    it('answers HEAD with the headers of the range', async () => {
      const response = await request('/digits.txt', 'HEAD', { range: 'bytes=2-4' });

      expect(response).toMatchObject({ statusCode: 206, body: '', headers: { 'Content-Range': 'bytes 2-4/10', 'Content-Length': '3' } });
    });

    it('answers 304 before it looks at the range', async () => {
      const { headers } = await request('/digits.txt');

      expect((await ranged('/digits.txt', 'bytes=0-1', { 'if-none-match': headers.ETag })).statusCode).toBe(304);
    });

    it('streams the range of a big file, and only that', async () => {
      const parts: ResponseEvent[] = [];
      const start = 1024 * 1024 + 5;
      const end = 3 * 1024 * 1024 + 99;

      await staticWorker(event('/big.bin', 'GET', { range: `bytes=${start}-${end}` }), (part) => {
        if ('handOff' in part) return Promise.resolve(undefined);
        parts.push(part);
        return Promise.resolve(true);
      });

      expect(parts[0]).toMatchObject({
        statusCode: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${big.length}`, 'Content-Length': String(end - start + 1) },
      });
      expect(Buffer.concat(parts.map(({ body }) => body).filter(Buffer.isBuffer)).equals(big.subarray(start, end + 1))).toBe(true);
    });
  });

  describe('with options', () => {
    /** the worker as a process gets it: the options are read from its environment when it loads */
    const workerWith = (options: StaticOptions) => {
      let worker: InvokableWorker;
      process.env[StaticOptionsEnv] = JSON.stringify(options);
      jest.isolateModules(() => {
        worker = jest.requireActual('./static-worker');
      });
      delete process.env[StaticOptionsEnv];

      return (requestPath: string, headers: Record<string, string> = {}, httpMethod = 'GET') =>
        new Promise<ResponseEvent & { headers: Record<string, string> }>((resolve) => {
          worker(event(requestPath, httpMethod, headers), (response) => resolve(withSingleValues(response)));
        });
    };

    describe('cacheControl', () => {
      const get = workerWith({
        cacheControl: [
          { folder: '/assets/', extension: 'JS', value: 'public, max-age=31536000, immutable' },
          { extension: '.css', value: 'public, max-age=60' },
          { folder: 'listed', value: 'no-store' },
        ],
      });

      it('uses the first rule that matches', async () => {
        expect((await get('/assets/app.js')).headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
        expect((await get('/assets/plain.css')).headers['Cache-Control']).toBe('public, max-age=60');
        expect((await get('/listed/a.txt')).headers['Cache-Control']).toBe('no-store');
      });

      it('needs both the folder and the extension of a rule', async () => {
        expect((await get('/index.html')).headers['Cache-Control']).toBe('public, max-age=0');
        expect((await get('/digits.txt')).headers['Cache-Control']).toBe('public, max-age=0');
      });

      it('keeps max-age=0 without options', async () => {
        expect((await request('/assets/app.js')).headers['Cache-Control']).toBe('public, max-age=0');
      });
    });

    describe('listDirectories', () => {
      const get = workerWith({ listDirectories: true });

      it('lists a folder without an index file, folders first, and not the hidden files', async () => {
        const response = await get('/listed/');
        const body = bodyOf(response);

        expect(response).toMatchObject({ statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        expect(body.indexOf('inner/')).toBeLessThan(body.indexOf('a.txt'));
        expect(body.indexOf('a.txt')).toBeLessThan(body.indexOf('b '));
        expect(body).not.toContain('hidden');
      });

      it('escapes the names', async () => {
        const body = bodyOf(await get('/listed/'));

        // characters that file names may not have on Windows (< > ") are escaped the same way, see render-directory-listing.test.ts
        expect(body).toContain('>b &amp; &#39;c&#39;.txt</a>');
        expect(body).toContain('href="b%20%26%20&#39;c&#39;.txt"');
      });

      it('lists the root, without a link to the folder above it', async () => {
        await fs.rm(path.join(root, 'index.html'));
        const body = bodyOf(await get('/'));
        await fs.writeFile(path.join(root, 'index.html'), '<h1>home</h1>');

        expect(body).toContain('digits.txt');
        expect(body).not.toContain('../');
      });

      it('prefers the index file', async () => {
        expect(bodyOf(await get('/withIndex/'))).toBe('index');
      });

      it('redirects a folder to the path with a slash, on this host', async () => {
        expect(await get('/listed')).toMatchObject({ statusCode: 301, headers: { Location: '/listed/' } });
        expect((await get('//listed')).headers.Location).toBe('/listed/');
      });

      it('answers HEAD without the list', async () => {
        const response = await get('/listed/', {}, 'HEAD');

        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('');
      });

      it('does not list what is outside of the root, or other methods', async () => {
        expect((await get('/../')).statusCode).toBe(404);
        expect((await get('/listed/', {}, 'POST')).statusCode).toBe(404);
      });

      it('answers a missing folder with 404', async () => {
        expect((await get('/nothing/')).statusCode).toBe(404);
      });

      it('does not list without the option', async () => {
        expect((await request('/listed/')).statusCode).toBe(404);
      });
    });

    describe('precompressed', () => {
      const get = workerWith({ precompressed: ['br', 'gzip'] });

      it('sends the first variant the client accepts', async () => {
        const response = await get('/assets/app.js', { 'accept-encoding': 'gzip, br' });

        expect(response).toMatchObject({
          statusCode: 200,
          headers: { 'Content-Encoding': 'br', Vary: 'Accept-Encoding', 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': '12' },
        });
        expect(bodyOf(response)).toBe('brotli bytes');
      });

      it('falls back to the next encoding', async () => {
        const response = await get('/assets/app.js', { 'accept-encoding': 'gzip' });

        expect(response.headers['Content-Encoding']).toBe('gzip');
        expect(bodyOf(response)).toBe('gzip bytes');
      });

      it('respects a refused encoding and a wildcard', async () => {
        expect((await get('/assets/app.js', { 'accept-encoding': 'br;q=0, gzip' })).headers['Content-Encoding']).toBe('gzip');
        expect((await get('/assets/app.js', { 'accept-encoding': '*' })).headers['Content-Encoding']).toBe('br');
      });

      it('sends the file as it is to a client that accepts neither, but still varies', async () => {
        const response = await get('/assets/app.js', { 'accept-encoding': 'deflate' });

        expect(bodyOf(response)).toBe('console.log(1);');
        expect(response.headers['Content-Encoding']).toBeUndefined();
        expect(response.headers.Vary).toBe('Accept-Encoding');
        expect((await get('/assets/app.js')).headers['Content-Encoding']).toBeUndefined();
      });

      it('does not vary for a file that has no variant', async () => {
        const response = await get('/assets/plain.css', { 'accept-encoding': 'br' });

        expect(response.headers).not.toHaveProperty('Content-Encoding');
        expect(response.headers).not.toHaveProperty('Vary');
      });

      it('has an ETag of its own for each variant, and answers 304 for it', async () => {
        const plain = await get('/assets/app.js');
        const variant = await get('/assets/app.js', { 'accept-encoding': 'br' });

        expect(variant.headers.ETag).not.toBe(plain.headers.ETag);
        expect((await get('/assets/app.js', { 'accept-encoding': 'br', 'if-none-match': variant.headers.ETag })).statusCode).toBe(304);
      });

      it('takes ranges of the variant', async () => {
        const response = await get('/assets/app.js', { 'accept-encoding': 'br', range: 'bytes=0-5' });

        expect(response).toMatchObject({ statusCode: 206, headers: { 'Content-Range': 'bytes 0-5/12', 'Content-Encoding': 'br' } });
        expect(bodyOf(response)).toBe('brotli');
      });

      it('does nothing without the option', async () => {
        const response = await request('/assets/app.js', 'GET', { 'accept-encoding': 'br' });

        expect(response.headers).not.toHaveProperty('Content-Encoding');
        expect(response.headers).not.toHaveProperty('Vary');
      });
    });
  });
});
