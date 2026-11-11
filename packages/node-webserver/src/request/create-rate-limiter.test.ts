import createRateLimiter from './create-rate-limiter';

describe('createRateLimiter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('counts every key on its own, and starts over in the next window', () => {
    const now = Date.now();
    const limiter = createRateLimiter(2, 1000);
    limiter.hit('a');
    limiter.hit('a');
    limiter.hit('b');

    expect(limiter.exceeded('a')).toBe(true);
    expect(limiter.exceeded('b')).toBe(false);

    jest.spyOn(Date, 'now').mockReturnValue(now + 1000);
    expect(limiter.exceeded('a')).toBe(false);
  });
});
