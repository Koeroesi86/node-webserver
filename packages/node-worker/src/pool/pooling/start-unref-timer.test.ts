import startUnrefTimer from './start-unref-timer';

describe('startUnrefTimer', () => {
  afterEach(() => jest.useRealTimers());

  it('does not keep the process alive', () => {
    const timer = startUnrefTimer(() => {}, 60000);

    expect(timer.hasRef()).toBe(false);
    clearTimeout(timer);
  });

  it('calls back once the delay passed', () => {
    jest.useFakeTimers();
    const callback = jest.fn();

    startUnrefTimer(callback, 100);
    jest.advanceTimersByTime(99);
    expect(callback).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
