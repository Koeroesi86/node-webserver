import type { CompressionEncoding } from '../utils/compression-streams';

export interface CompressionOptions {
  /** responses of a known size below this many bytes are sent as they are. Defaults to 1024. */
  threshold?: number;
  /** level of gzip and deflate, 1 (fast) to 9 (small). Defaults to 6. */
  level?: number;
  /** quality of brotli, 0 (fast) to 11 (small). Defaults to 4, as higher qualities are slow. */
  brotliQuality?: number;
  /** what may be used, in the order of preference when the client likes them the same. Defaults to all of them: br, gzip, deflate. */
  encodings?: CompressionEncoding[];
  /**
   * how many responses the whole process compresses at the same time, the others are sent as they are, as the threadpool of node that runs zlib also runs
   * the file system and DNS work. Defaults to 0, no limit.
   */
  concurrency?: number;
}

export type { CompressionEncoding };
