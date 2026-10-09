/** counts what happens per key in a fixed window, and tells when a key reached the limit of the window */
const createRateLimiter = (limit: number, window: number) => {
  let counts = new Map<string, number>();
  let windowStart = Date.now();

  const current = () => {
    // a new window forgets the old one at once, so the map holds the keys of one window at most
    if (Date.now() - windowStart >= window) {
      counts = new Map();
      windowStart = Date.now();
    }

    return counts;
  };

  return {
    exceeded: (key: string) => (current().get(key) ?? 0) >= limit,
    hit: (key: string) => {
      const map = current();
      map.set(key, (map.get(key) ?? 0) + 1);
    },
  };
};

export default createRateLimiter;
