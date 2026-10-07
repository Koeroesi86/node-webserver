import zlib from 'zlib';
import type { Transform } from 'stream';
import type { RequestHandler, Response } from 'express';
import type { CompressionEncoding, CompressionOptions } from '../types';

type Headers = Record<string, unknown>;

const defaultEncodings: CompressionEncoding[] = ['br', 'gzip', 'deflate'];
const compressibleTypes =
  /^(text\/|application\/(json|(x-)?javascript|xml|wasm|manifest\+json|.+\+(json|xml))|image\/svg\+xml|font\/(ttf|otf)|application\/vnd\.ms-fontobject)/i;
const bodylessStatuses = [204, 205, 304];

const lowerCased = (headers: Headers) => Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
const asString = (value: unknown) => (Array.isArray(value) ? value.join(', ') : `${value ?? ''}`);

/** The encoding to use: what the client accepts with the highest weight, the order of the options settles ties. */
export function chooseEncoding(acceptEncoding: string, supported: CompressionEncoding[]): CompressionEncoding | undefined {
  const weights = new Map<string, number>(
    acceptEncoding
      .toLowerCase()
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...parameters] = part.split(';').map((piece) => piece.trim());
        const weight = parameters.find((parameter) => parameter.startsWith('q='))?.slice(2);

        return [name, weight === undefined ? 1 : Number(weight) || 0];
      })
  );
  const weightOf = (encoding: CompressionEncoding) => weights.get(encoding) ?? weights.get('*') ?? 0;

  return supported
    .filter((encoding) => weightOf(encoding) > 0)
    .map((encoding, index) => ({ encoding, index }))
    .sort((a, b) => weightOf(b.encoding) - weightOf(a.encoding) || a.index - b.index)[0]?.encoding;
}

const createStream = (encoding: CompressionEncoding, { level = 6, brotliQuality = 4 }: CompressionOptions, size?: number): Transform => {
  // every write is flushed, so a response that is streamed reaches the client while it is produced instead of when a buffer fills
  if (encoding === 'br') {
    return zlib.createBrotliCompress({
      flush: zlib.constants.BROTLI_OPERATION_FLUSH,
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality, ...(size !== undefined && { [zlib.constants.BROTLI_PARAM_SIZE_HINT]: size }) },
    });
  }

  return (encoding === 'gzip' ? zlib.createGzip : zlib.createDeflate)({ level, flush: zlib.constants.Z_SYNC_FLUSH });
};

/**
 * Compresses the responses that are worth it for the clients that accept it, with the zlib of node: the work runs on the threads of node, not on the one
 * that serves the requests. It takes the decision when the headers are written: text like types, no encoding yet, and a size above the threshold if it is known.
 */
const compression =
  (options: CompressionOptions = {}): RequestHandler =>
  (request, response, next) => {
    const { threshold = 1024, encodings = defaultEncodings } = options;
    const encoding = chooseEncoding(asString(request.headers['accept-encoding']), encodings);
    const { writeHead, write, end } = response;
    const original = {
      writeHead: (...args: unknown[]) => Reflect.apply(writeHead, response, args),
      write: (...args: unknown[]) => Reflect.apply(write, response, args),
      end: (...args: unknown[]) => Reflect.apply(end, response, args),
    };
    let decided = false;
    let stream: Transform | undefined;

    const startCompressing = (compressionEncoding: CompressionEncoding, length: number | undefined) => {
      const compressor = createStream(compressionEncoding, options, length);
      // the compressed data goes out through the original write, and the source waits when the client does not keep up
      compressor.on('data', (chunk: Buffer) => {
        if (original.write(chunk) === false) compressor.pause();
      });
      compressor.on('end', () => original.end());
      compressor.on('error', () => response.destroy());
      response.on('drain', () => compressor.resume());
      response.on('close', () => compressor.destroy());
      stream = compressor;
    };

    /** the response head after the decision, `headers` are what is about to be sent: the ones given to writeHead on top of the ones set before */
    const decide = (statusCode: number, headers: Headers, bodySize?: number): Headers => {
      decided = true;
      const type = asString(headers['content-type']).split(';')[0].trim();
      const length = headers['content-length'] === undefined ? bodySize : Number(headers['content-length']);
      const isCompressible = compressibleTypes.test(type);
      const vary = asString(headers.vary);
      // caches have to know that the answer depends on what the client accepts, also when this one is not compressed
      const varied =
        isCompressible && !/(^|,)\s*(\*|accept-encoding)\s*(,|$)/i.test(vary) ? { Vary: vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding' } : {};
      const mayCompress =
        encoding !== undefined &&
        isCompressible &&
        request.method !== 'HEAD' &&
        statusCode >= 200 &&
        !bodylessStatuses.includes(statusCode) &&
        (headers['content-encoding'] === undefined || headers['content-encoding'] === 'identity') &&
        !/(^|,)\s*no-transform\s*(,|$)/i.test(asString(headers['cache-control'])) &&
        (length === undefined || Number.isNaN(length) || length >= threshold);

      if (!mayCompress) return varied;

      startCompressing(encoding, Number.isNaN(length) ? undefined : length);
      const etag = asString(headers.etag);

      // the size is not known any more, and a strong validator would promise the same bytes as the uncompressed answer
      return { ...varied, 'Content-Encoding': encoding, 'Content-Length': undefined, ...(etag && !etag.startsWith('W/') && { ETag: `W/${etag}` }) };
    };

    /** the head to write: the given headers without the ones that are to be replaced, and the replacements */
    const applyHead = (given: Headers | undefined, changes: Headers): Headers => {
      const replaced = new Set(Object.keys(changes).map((name) => name.toLowerCase()));
      const kept = Object.entries(given ?? {}).filter(([name]) => !replaced.has(name.toLowerCase()));

      return { ...Object.fromEntries(kept), ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) };
    };

    /** what was set before with setHeader is changed there */
    const applyChanges = (changes: Headers) =>
      Object.entries(changes).forEach(([name, value]) => (value === undefined ? response.removeHeader(name) : response.setHeader(name, value as string)));

    /** for the first write or end without writeHead: the head is made of what was set before, then written */
    const writeImplicitHead = (bodySize?: number) => {
      applyChanges(decide(response.statusCode, lowerCased(response.getHeaders()), bodySize));
      response.writeHead(response.statusCode);
    };

    Object.assign(response, {
      writeHead: (statusCode: number, ...rest: unknown[]) => {
        const given = rest.find((argument): argument is Headers => typeof argument === 'object' && argument !== null && !Array.isArray(argument));
        // a list of header names and values is rare and cannot be changed in place
        if (decided || rest.some(Array.isArray)) {
          decided = true;
          return original.writeHead(statusCode, ...rest);
        }

        const changes = decide(statusCode, { ...lowerCased(response.getHeaders()), ...lowerCased(given ?? {}) });
        applyChanges(changes);

        // what was given to writeHead takes precedence over what was set before, so it is changed there as well
        return original.writeHead(statusCode, ...rest.filter((argument) => argument !== given), applyHead(given, changes));
      },
      write: (chunk: unknown, ...rest: unknown[]) => {
        if (!decided) writeImplicitHead();

        return stream ? Reflect.apply(stream.write, stream, [chunk, ...rest]) : original.write(chunk, ...rest);
      },
      end: (chunk?: unknown, ...rest: unknown[]) => {
        if (!decided) writeImplicitHead(typeof chunk === 'string' || Buffer.isBuffer(chunk) ? Buffer.byteLength(chunk) : undefined);

        if (!stream) return original.end(chunk, ...rest);

        return Reflect.apply(stream.end, stream, chunk === undefined || typeof chunk === 'function' ? [chunk] : [chunk, ...rest]);
      },
    } satisfies Partial<Record<keyof Response, unknown>>);

    next();
  };

export default compression;
