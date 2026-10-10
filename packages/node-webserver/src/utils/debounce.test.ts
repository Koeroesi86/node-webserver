import debounce from './debounce';

describe('debounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls once for calls that come quickly one after the other', () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 100);

    debounced();
    jest.advanceTimersByTime(50);
    debounced();
    jest.advanceTimersByTime(50);
    debounced();
    jest.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls again for calls after the wait', () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 100);

    debounced();
    jest.advanceTimersByTime(100);
    debounced();
    jest.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(2);
  });
});
