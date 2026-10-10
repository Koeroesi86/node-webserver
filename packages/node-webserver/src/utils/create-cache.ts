import type { Cache, CacheOptions } from '../types/cache';

interface Entry<V> {
  value: V;
  bytes: number;
  expiresAt: number;
}

const bufferLength = (value: unknown) => (Buffer.isBuffer(value) ? value.length : 0);

// a NaN ttl would never expire
const checkTtl = (ttl: number | undefined) => {
  if (Number.isNaN(ttl)) throw new RangeError('the ttl of the cache has to be a number');
};

/**
 * A least recently used cache bounded by entries and by bytes, whichever is hit first. A `Map` keeps the order of insertion,
 * so a hit is inserted again to move it to the end and the first key is the one pushed out.
 * No timer runs in the front process: an expired entry is dropped when it is read, and the ones that expired first are dropped on every `set`.
 * Checking that a value is still true (a `stat`) is left to the caller.
 */
const createCache = <V>({ maxEntries, maxBytes = Infinity, ttl, sizeOf = bufferLength, now = () => performance.now() }: CacheOptions<V>): Cache<V> => {
  // a NaN limit compares false and would turn the limit off
  if (!Number.isInteger(maxEntries) || maxEntries < 0)
    throw new RangeError(`the maxEntries of the cache has to be a whole number of 0 or more, got ${maxEntries}`);
  if (Number.isNaN(maxBytes) || maxBytes < 0) throw new RangeError(`the maxBytes of the cache has to be 0 or more, got ${maxBytes}`);
  checkTtl(ttl);

  const entries = new Map<string, Entry<V>>();
  // the entries that expire, in the order they were set, which is the order they expire in while they share the ttl of the cache
  const expiring = new Map<string, Entry<V>>();
  let bytes = 0;

  const remove = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return false;

    bytes -= entry.bytes;
    expiring.delete(key);
    return entries.delete(key);
  };

  // stops at the first entry still valid, so an entry with a longer ttl of its own keeps the ones set after it until they are read or pushed out
  const dropExpired = () => {
    const time = now();
    for (const [key, entry] of expiring) {
      if (time < entry.expiresAt) return;
      remove(key);
    }
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
      checkTtl(options?.ttl);
      remove(key);
      dropExpired();
      const entryBytes = sizeOf(value);
      const entryTtl = options?.ttl ?? ttl;
      // a value that could never fit would empty the cache and still be pushed out, one that has already expired would push out a valid one
      if (maxEntries < 1 || entryBytes > maxBytes || (entryTtl !== undefined && entryTtl <= 0)) return;

      const entry = { value, bytes: entryBytes, expiresAt: entryTtl === undefined ? Infinity : now() + entryTtl };
      entries.set(key, entry);
      if (entryTtl !== undefined) expiring.set(key, entry);
      bytes += entryBytes;
      evict();
    },
    delete: remove,
    clear: () => {
      entries.clear();
      expiring.clear();
      bytes = 0;
    },
    get size() {
      dropExpired();
      return entries.size;
    },
    get bytes() {
      dropExpired();
      return bytes;
    },
  };
};

export default createCache;
