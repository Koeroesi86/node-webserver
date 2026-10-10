export interface CacheOptions<V> {
  /** the most entries the cache keeps */
  maxEntries: number;
  /** the most bytes the values may take together, counted with `sizeOf`, no limit when left out */
  maxBytes?: number;
  /** milliseconds an entry stays valid for, unless `set` gives its own, no expiry when left out; an entry with 0 or less is not kept */
  ttl?: number;
  /** the bytes a value takes, the length of the raw `Buffer` it holds; when left out, the length of a value that is a `Buffer` and 0 for any other */
  sizeOf?: (value: V) => number;
  /** the clock in milliseconds, `performance.now` when left out, as it does not move with the clock of the system */
  now?: () => number;
}

export interface CacheSetOptions {
  /** milliseconds this entry stays valid for, instead of the `ttl` of the cache */
  ttl?: number;
}

/** the interface a cache of another store (Redis or similar) can be plugged in behind */
export interface Cache<V> {
  get: (key: string) => V | undefined;
  set: (key: string, value: V, options?: CacheSetOptions) => void;
  delete: (key: string) => boolean;
  clear: () => void;
  /** the entries kept, without the ones that expired first (see `createCache` for the others) */
  readonly size: number;
  readonly bytes: number;
}
