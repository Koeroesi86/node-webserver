export interface CacheOptions<V> {
  /** the most entries the cache keeps */
  maxEntries: number;
  /** the most bytes the values may take together, counted with `sizeOf`, no limit when left out */
  maxBytes?: number;
  /** milliseconds an entry stays valid for, unless `set` gives its own, no expiry when left out */
  ttl?: number;
  /** the bytes a value takes, the length of the raw `Buffer` it holds, 0 for every value when left out */
  sizeOf?: (value: V) => number;
  /** the clock in milliseconds, `Date.now` when left out */
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
  /** the entries kept, expired ones included until they are read or pushed out */
  readonly size: number;
  readonly bytes: number;
}
