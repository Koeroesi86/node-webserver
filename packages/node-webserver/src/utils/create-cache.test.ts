import createCache from './create-cache';

const createClock = () => {
  let time = 1000;

  return {
    now: () => time,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
};

const sizeOf = (value: Buffer) => value.length;

describe('createCache', () => {
  it('gives back what was set and nothing for a key it does not have', () => {
    const cache = createCache<string>({ maxEntries: 2 });
    cache.set('a', 'one');

    expect([cache.get('a'), cache.get('b')]).toEqual(['one', undefined]);
  });

  it('pushes out the least recently used entry when there are too many', () => {
    const cache = createCache<number>({ maxEntries: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a');
    cache.set('d', 4);

    expect(['a', 'b', 'c', 'd'].map(cache.get)).toEqual([1, undefined, 3, 4]);
    expect(cache.size).toBe(3);
  });

  it('counts setting a key again as a use', () => {
    const cache = createCache<number>({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10);
    cache.set('c', 3);

    expect(['a', 'b', 'c'].map(cache.get)).toEqual([10, undefined, 3]);
  });

  it('pushes out the least recently used entries until the bytes fit', () => {
    const cache = createCache<Buffer>({ maxEntries: 10, maxBytes: 10, sizeOf });
    cache.set('a', Buffer.alloc(4));
    cache.set('b', Buffer.alloc(4));
    cache.set('c', Buffer.alloc(2));
    cache.get('a');
    cache.set('d', Buffer.alloc(3));

    expect(['a', 'b', 'c', 'd'].map((key) => cache.get(key)?.length)).toEqual([4, undefined, 2, 3]);
    expect(cache.bytes).toBe(9);
  });

  it('counts the bytes of the raw value', () => {
    const cache = createCache<Buffer>({ maxEntries: 10, sizeOf });
    cache.set('a', Buffer.from('héllo'));
    cache.set('b', Buffer.alloc(3));
    cache.set('a', Buffer.alloc(1));
    cache.delete('b');

    expect(cache.bytes).toBe(1);
  });

  it('does not keep a value larger than the whole cache, nor push the others out for it', () => {
    const cache = createCache<Buffer>({ maxEntries: 10, maxBytes: 10, sizeOf });
    cache.set('a', Buffer.alloc(5));
    cache.set('b', Buffer.alloc(11));

    expect([cache.get('a')?.length, cache.get('b')]).toEqual([5, undefined]);
    expect(cache.bytes).toBe(5);
  });

  it('drops the old value of a key that is set to one too large', () => {
    const cache = createCache<Buffer>({ maxEntries: 10, maxBytes: 10, sizeOf });
    cache.set('a', Buffer.alloc(5));
    cache.set('a', Buffer.alloc(11));

    expect(cache.get('a')).toBeUndefined();
    expect(cache.bytes).toBe(0);
  });

  it('keeps nothing with no room for entries', () => {
    const cache = createCache<number>({ maxEntries: 0 });
    cache.set('a', 1);

    expect([cache.get('a'), cache.size]).toEqual([undefined, 0]);
  });

  it('drops an entry read after the ttl of the cache', () => {
    const clock = createClock();
    const cache = createCache<number>({ maxEntries: 2, ttl: 1000, now: clock.now });
    cache.set('a', 1);
    clock.advance(999);
    const before = cache.get('a');
    clock.advance(1);

    expect([before, cache.get('a'), cache.size]).toEqual([1, undefined, 0]);
  });

  it('does not extend the ttl on a read', () => {
    const clock = createClock();
    const cache = createCache<number>({ maxEntries: 2, ttl: 1000, now: clock.now });
    cache.set('a', 1);
    clock.advance(600);
    cache.get('a');
    clock.advance(600);

    expect(cache.get('a')).toBeUndefined();
  });

  it('starts the ttl again when a key is set again', () => {
    const clock = createClock();
    const cache = createCache<number>({ maxEntries: 2, ttl: 1000, now: clock.now });
    cache.set('a', 1);
    clock.advance(600);
    cache.set('a', 2);
    clock.advance(600);

    expect(cache.get('a')).toBe(2);
  });

  it('lets an entry have its own ttl', () => {
    const clock = createClock();
    const cache = createCache<number>({ maxEntries: 3, ttl: 1000, now: clock.now });
    cache.set('short', 1, { ttl: 100 });
    cache.set('long', 2, { ttl: 5000 });
    cache.set('default', 3);
    clock.advance(2000);

    expect(['short', 'long', 'default'].map(cache.get)).toEqual([undefined, 2, undefined]);
  });

  it('keeps an entry with no ttl', () => {
    const clock = createClock();
    const cache = createCache<number>({ maxEntries: 1, now: clock.now });
    cache.set('a', 1);
    clock.advance(Number.MAX_SAFE_INTEGER / 2);

    expect(cache.get('a')).toBe(1);
  });

  it('gives the bytes of an expired entry back when it is dropped', () => {
    const clock = createClock();
    const cache = createCache<Buffer>({ maxEntries: 2, maxBytes: 10, ttl: 100, sizeOf, now: clock.now });
    cache.set('a', Buffer.alloc(6));
    clock.advance(100);
    cache.get('a');

    expect(cache.bytes).toBe(0);
  });

  it('deletes an entry and clears all of them', () => {
    const cache = createCache<Buffer>({ maxEntries: 3, sizeOf });
    cache.set('a', Buffer.alloc(1));
    cache.set('b', Buffer.alloc(2));
    cache.set('c', Buffer.alloc(3));

    expect([cache.delete('a'), cache.delete('a'), cache.get('a'), cache.bytes]).toEqual([true, false, undefined, 5]);

    cache.clear();

    expect([cache.size, cache.bytes, cache.get('b')]).toEqual([0, 0, undefined]);
  });

  it('works when its methods are passed around', () => {
    const { set, get } = createCache<number>({ maxEntries: 1 });
    set('a', 1);

    expect(get('a')).toBe(1);
  });
});
