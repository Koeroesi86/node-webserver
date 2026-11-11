import createResponseTimeout from './create-response-timeout';

describe('createResponseTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('fires when the response makes no progress for the limit', () => {
    const onTimeout = jest.fn();
    createResponseTimeout(1000, onTimeout).arm();

    jest.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('waits for the rest of the limit after a sign of progress', () => {
    const onTimeout = jest.fn();
    const timeout = createResponseTimeout(1000, onTimeout);
    timeout.arm();

    jest.advanceTimersByTime(600);
    timeout.arm();
    jest.advanceTimersByTime(600);
    expect(onTimeout).not.toHaveBeenCalled();

    jest.advanceTimersByTime(400);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not fire once cleared, also when armed again by a late message', () => {
    const onTimeout = jest.fn();
    const timeout = createResponseTimeout(1000, onTimeout);
    timeout.arm();
    timeout.clear();
    timeout.arm();

    jest.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('does nothing without a limit', () => {
    const onTimeout = jest.fn();
    createResponseTimeout(undefined, onTimeout).arm();

    jest.advanceTimersByTime(60000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
