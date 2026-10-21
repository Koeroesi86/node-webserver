import type { Transform } from 'stream';
import type { CompressionEncoding } from '../utils';

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
   * how many responses the whole server compresses at the same time (all its virtual hosts together), the others are sent as they are, as the threadpool of
   * node that runs zlib also runs the file system and DNS work. Defaults to 0, no limit.
   */
  concurrency?: number;
}

/** the places for the responses that are compressed at the same time, shared by the servers of one `startServer` call */
export interface CompressionBudget {
  /** how many responses are compressed now */
  getActive: () => number;
  /** takes a place, the returned function gives it back (once, however often it is called) */
  acquire: () => () => void;
}

/** the headers of a response by lower case name, as they are known before they are written */
export type HeaderMap = Record<string, unknown>;

/** the headers the compression sets or, as `undefined`, removes */
export type HeaderChanges = Record<string, string | undefined>;

/** where the compressed data goes out: the write and end of the response as they were before the compression replaced them */
export interface ResponseOutput {
  write: (...args: unknown[]) => boolean;
  end: (...args: unknown[]) => unknown;
}

/** what the compression decided for a response: the headers to change, and the stream the body goes through when it is compressed */
export interface CompressionDecision {
  changes: HeaderChanges;
  stream?: Transform;
}

export type { CompressionEncoding };
