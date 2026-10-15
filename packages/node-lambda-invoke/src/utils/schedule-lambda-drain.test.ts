import type Lambda from '../classes/Lambda';
import scheduleLambdaDrain from './schedule-lambda-drain';
import { DRAIN_AFTER } from '../constants';

const createInstance = (busy: boolean) => {
  const closeListeners: (() => void)[] = [];
  const terminate = jest.fn();
  const instance = {
    retiring: false,
    busy,
    terminate,
    addEventListenerOnce: (_event: string, listener: () => void) => closeListeners.push(listener),
  };

  // the util only uses what the fake has
  return { instance: instance as unknown as Lambda, terminate, close: () => closeListeners.forEach((listener) => listener()) };
};

describe('scheduleLambdaDrain', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('retires an idle lambda once it has had its time, and logs it', () => {
    const { instance, terminate } = createInstance(false);
    const logger = jest.fn();

    scheduleLambdaDrain(instance, 'abc', logger);
    jest.advanceTimersByTime(DRAIN_AFTER - 1);
    expect(instance.retiring).toBe(false);

    jest.advanceTimersByTime(1);
    expect(instance.retiring).toBe(true);
    expect(logger).toHaveBeenCalledWith('[abc] draining');
    expect(terminate).toHaveBeenCalledWith('SIGTERM');
  });

  it('lets a busy lambda finish its request', () => {
    const { instance, terminate } = createInstance(true);

    scheduleLambdaDrain(instance, 'abc', jest.fn());
    jest.advanceTimersByTime(DRAIN_AFTER);

    expect(instance.retiring).toBe(true);
    expect(terminate).not.toHaveBeenCalled();
  });

  it('does nothing for a lambda that closed before', () => {
    const { instance, close } = createInstance(false);
    const logger = jest.fn();

    scheduleLambdaDrain(instance, 'abc', logger);
    close();
    jest.advanceTimersByTime(DRAIN_AFTER);

    expect(logger).not.toHaveBeenCalled();
  });
});
