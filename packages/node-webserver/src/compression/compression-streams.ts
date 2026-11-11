import zlib from 'zlib';
import type { Transform } from 'stream';

interface StreamOptions {
  level?: number;
  brotliQuality?: number;
}

type CompressionStreamFactory = (options: StreamOptions, size?: number) => Transform;

const levelOf = ({ level = 6 }: StreamOptions) => ({ level, flush: zlib.constants.Z_SYNC_FLUSH });

/**
 * the compression streams by the name of the encoding in `Accept-Encoding`, in the order of preference when the client likes them the same: an encoding is
 * added with an entry here. Every write is flushed, so a response that is streamed reaches the client while it is produced instead of when a buffer fills.
 */
export const compressionStreams = {
  br: ({ brotliQuality = 4 }, size) =>
    zlib.createBrotliCompress({
      flush: zlib.constants.BROTLI_OPERATION_FLUSH,
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality, ...(size !== undefined && { [zlib.constants.BROTLI_PARAM_SIZE_HINT]: size }) },
    }),
  gzip: (options) => zlib.createGzip(levelOf(options)),
  deflate: (options) => zlib.createDeflate(levelOf(options)),
} satisfies Record<string, CompressionStreamFactory>;

export type CompressionEncoding = keyof typeof compressionStreams;

export const defaultEncodings = Object.keys(compressionStreams).filter((name): name is CompressionEncoding => name in compressionStreams);
