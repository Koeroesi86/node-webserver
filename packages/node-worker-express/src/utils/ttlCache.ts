/**
 * A map whose entries expire. Expiry is checked when an entry is read, there is no timer per entry, which would be kept alive for the whole time to live
 * for every key ever seen. The size is bounded as well, the oldest entries go first, so that a client asking for endless different paths cannot grow it.
 */
class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>();

  constructor(private readonly ttl: number, private readonly maxSize: number) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);

    if (entry === undefined) {
      return undefined;
    }

    if (entry.expires <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /** the entry keeps the expiry it was given when it was first set, as long as it has not expired */
  set(key: string, value: V) {
    if (this.get(key) !== undefined) {
      return;
    }

    // a Map keeps the order of insertion, so the first key is the oldest one
    if (this.entries.size >= this.maxSize) {
      this.entries.delete(this.entries.keys().next().value);
    }

    this.entries.set(key, { value, expires: Date.now() + this.ttl });
  }

  get size() {
    return this.entries.size;
  }
}

export default TtlCache;
