import startUnrefInterval from './start-unref-interval';

describe('startUnrefInterval', () => {
  afterEach(() => jest.useRealTimers());

  it('does not keep the process alive', () => {
    const timer = startUnrefInterval(() => {}, 60000);

    expect(timer.hasRef()).toBe(false);
    clearInterval(timer);
  });

  it('calls back every time the delay passed', () => {
    jest.useFakeTimers();
    const callback = jest.fn();

    const timer = startUnrefInterval(callback, 100);
    jest.advanceTimersByTime(250);
    clearInterval(timer);

    expect(callback).toHaveBeenCalledTimes(2);
  });
});
