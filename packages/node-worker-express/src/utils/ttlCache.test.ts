import TtlCache from './ttlCache';

describe('TtlCache', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: 1000000 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns what was set, until it expires', () => {
    const cache = new TtlCache<string>(5000, 10);

    cache.set('a', 'value');
    expect(cache.get('a')).toBe('value');

    jest.advanceTimersByTime(4999);
    expect(cache.get('a')).toBe('value');

    jest.advanceTimersByTime(1);
    expect(cache.get('a')).toBeUndefined();
  });

  it('does not know keys that were never set', () => {
    expect(new TtlCache<string>(5000, 10).get('missing')).toBeUndefined();
  });

  it('removes an entry that expired when it is read', () => {
    const cache = new TtlCache<string>(1000, 10);
    cache.set('a', 'value');

    jest.advanceTimersByTime(1000);
    cache.get('a');

    expect(cache.size).toBe(0);
  });

  it('keeps the first value and its expiry while the entry is alive, as reading must not extend it', () => {
    const cache = new TtlCache<string>(1000, 10);
    cache.set('a', 'first');

    jest.advanceTimersByTime(600);
    cache.set('a', 'second');
    jest.advanceTimersByTime(500);

    expect(cache.get('a')).toBeUndefined();
  });

  it('takes a value again once the entry expired', () => {
    const cache = new TtlCache<string>(1000, 10);
    cache.set('a', 'first');
    jest.advanceTimersByTime(1000);

    cache.set('a', 'second');

    expect(cache.get('a')).toBe('second');
  });

  it('drops the oldest entries when it is full', () => {
    const cache = new TtlCache<number>(5000, 3);

    [1, 2, 3, 4, 5].forEach((value) => cache.set(`key${value}`, value));

    expect(cache.size).toBe(3);
    expect(['key1', 'key2'].map((key) => cache.get(key))).toEqual([undefined, undefined]);
    expect(['key3', 'key4', 'key5'].map((key) => cache.get(key))).toEqual([3, 4, 5]);
  });

  it('stays at its size for any number of different keys', () => {
    const cache = new TtlCache<number>(5000, 100);

    Array.from({ length: 10000 }, (_, index) => cache.set(`/scan/${index}`, index));

    expect(cache.size).toBe(100);
  });

  it('does not keep the process alive, as it has no timers', () => {
    const cache = new TtlCache<number>(5000, 100);

    cache.set('a', 1);

    expect(jest.getTimerCount()).toBe(0);
  });
});
