import zlib from 'zlib';
import { compressionStreams, defaultEncodings } from './compression-streams';

const compress = async (encoding: keyof typeof compressionStreams, input: string, options = {}) => {
  const stream = compressionStreams[encoding](options, input.length);
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const ended = new Promise((resolve) => stream.on('end', resolve));
  stream.end(input);
  await ended;

  return Buffer.concat(chunks);
};

describe('compressionStreams', () => {
  const text = 'hello world '.repeat(200);

  it('lists every encoding by default, brotli first', () => {
    expect(defaultEncodings).toEqual(['br', 'gzip', 'deflate']);
  });

  it.each([
    ['br', zlib.brotliDecompressSync],
    ['gzip', zlib.gunzipSync],
    ['deflate', zlib.inflateSync],
  ] as const)('makes a stream of %s that the client can decode', async (encoding, decode) => {
    expect(decode(await compress(encoding, text)).toString()).toBe(text);
  });

  it('uses the level for gzip', async () => {
    const fast = await compress('gzip', text, { level: 1 });
    const small = await compress('gzip', text, { level: 9 });

    expect(small.length).toBeLessThanOrEqual(fast.length);
  });
});
