import type { Cache, CacheOptions } from '../types/cache';

interface Entry<V> {
  value: V;
  bytes: number;
  expiresAt: number;
}

/**
 * A least recently used cache bounded by entries and by bytes, whichever is hit first. A `Map` keeps the order of insertion,
 * so a hit is inserted again to move it to the end and the first key is the one pushed out.
 * An expired entry is dropped when it is read, so no timer runs in the front process; checking that a value is still true (a `stat`) is left to the caller.
 */
const createCache = <V>({ maxEntries, maxBytes = Infinity, ttl, sizeOf = () => 0, now = Date.now }: CacheOptions<V>): Cache<V> => {
  const entries = new Map<string, Entry<V>>();
  let bytes = 0;

  const remove = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return false;

    bytes -= entry.bytes;
    return entries.delete(key);
  };

  const evict = () => {
    while (entries.size > maxEntries || bytes > maxBytes) {
      const oldest = entries.keys().next();
      if (oldest.done) return;
      remove(oldest.value);
    }
  };

  return {
    get: (key) => {
      const entry = entries.get(key);
      if (!entry) return undefined;

      if (now() >= entry.expiresAt) {
        remove(key);
        return undefined;
      }

      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set: (key, value, options) => {
      remove(key);
      const entryBytes = sizeOf(value);
      // a value that could never fit would empty the cache and still be pushed out
      if (maxEntries < 1 || entryBytes > maxBytes) return;

      const entryTtl = options?.ttl ?? ttl;
      entries.set(key, { value, bytes: entryBytes, expiresAt: entryTtl === undefined ? Infinity : now() + entryTtl });
      bytes += entryBytes;
      evict();
    },
    delete: remove,
    clear: () => {
      entries.clear();
      bytes = 0;
    },
    get size() {
      return entries.size;
    },
    get bytes() {
      return bytes;
    },
  };
};

export default createCache;
