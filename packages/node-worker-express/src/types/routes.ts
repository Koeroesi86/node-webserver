/** what a route of a static table is matched by: a path as it is, or a pattern for the whole path */
export type RouteSelector =
  | {
      /** the path as it is, which is looked up in a map */
      path: string;
    }
  | {
      /**
       * a regular expression that the whole path (without the query) has to match, it is anchored at both ends. Named groups are handed on as `pathParameters`.
       * It runs on the front process for every request that gets to it, so it is trusted configuration: avoid patterns that backtrack, like nested repetitions.
       */
      pattern: string;
      /** of the regular expression: `i`, `s`, `u` or `v` */
      flags?: string;
    };

/**
 * A route of the static table: a request whose path matches it goes to `worker`, without looking for a worker in the files under the root.
 * The worker is always the file named here, never a path made from the request.
 */
export type WorkerRoute =
  | {
      /** the path as it is, which is looked up in a map */
      path: string;
      /** the worker file, relative to the root or absolute, and may be outside of the root */
      worker: string;
    }
  | {
      /**
       * a regular expression that the whole path (without the query) has to match, it is anchored at both ends. Named groups are handed to the worker as `pathParameters`.
       * It runs on the front process for every request that gets to it, so it is trusted configuration: avoid patterns that backtrack, like nested repetitions.
       */
      pattern: string;
      /** of the regular expression: `i`, `s`, `u` or `v` */
      flags?: string;
      /** the worker file, relative to the root or absolute, and may be outside of the root */
      worker: string;
    };

/** the first rule that matches a request path sets its `Cache-Control`. A rule needs a `folder`, an `extension` or both, and then both must match. */
export interface CacheControlRule {
  /** a folder of the request paths, like `/assets/` */
  folder?: string;
  /** a file extension, with or without the dot, not case sensitive */
  extension?: string;
  /** the header value, like `public, max-age=31536000, immutable` */
  value: string;
}

export type PrecompressedEncoding = 'br' | 'gzip';

/** what the static worker does besides sending files, all of it in the worker and not in the server */
export interface StaticOptions {
  /** `Cache-Control` per request path, in order. Without a match it is `public, max-age=0`. */
  cacheControl?: CacheControlRule[];
  /** answer a folder without an index file with a list of it, hidden files (starting with a dot) left out. Off by default. */
  listDirectories?: boolean;
  /** look for `file.br` (`br`) and `file.gz` (`gzip`) next to a file, and send the first one the client accepts, in this order. Off by default. */
  precompressed?: PrecompressedEncoding[];
}
