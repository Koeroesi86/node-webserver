import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { StaticStreamThreshold } from './constants';
import staticWorker from './staticWorker';
import type { ResponseEvent, WorkerRequestEvent } from './types';

jest.mock('./utils/getCharset', () => ({ __esModule: true, default: jest.fn().mockResolvedValue('utf-8') }));

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
    await fs.writeFile(path.join(root, 'big.bin'), big);
    await fs.writeFile(path.join(root, 'icon.ico'), Buffer.from([1, 2, 3]));
    await fs.writeFile(path.join(parent, 'secret.txt'), 'classified content');
  });

  afterAll(async () => {
    jest.useRealTimers();
    await fs.rm(parent, { recursive: true, force: true });
  });

  const event = (requestPath: string, httpMethod = 'GET', headers: Record<string, string> = {}) =>
    ({ httpMethod, path: requestPath, rootPath: root, headers } as WorkerRequestEvent);

  /** the first response of the worker */
  const request = (requestPath: string, httpMethod = 'GET', headers: Record<string, string> = {}) =>
    new Promise<ResponseEvent>((resolve) => {
      staticWorker(event(requestPath, httpMethod, headers), resolve);
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

  it.each(['/../secret.txt', '/sub/../../secret.txt', '/....//secret.txt'])('does not serve files outside of the root through %s', async (requestPath) => {
    const response = await request(requestPath);

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('classified');
  });

  it('does not serve other methods than GET and HEAD', async () => {
    expect((await request('/index.html', 'POST')).statusCode).toBe(404);
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
          if (sent !== previous) {
            previous = sent;
            since = process.hrtime.bigint();
          }
          await new Promise((resolve) => setImmediate(resolve));
        }
      };
      const done = staticWorker(event('/big.bin'), () => {
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
        const size = Buffer.isBuffer(part.body) ? part.body.length : 0;
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
});
