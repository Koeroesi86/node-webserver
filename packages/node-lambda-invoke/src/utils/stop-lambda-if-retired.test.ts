import type Lambda from '../classes/Lambda';
import stopLambdaIfRetired from './stop-lambda-if-retired';
import { STOP_GRACE } from '../constants';

const createInstance = (state: { retiring: boolean; busy: boolean }) => {
  const closeListeners: (() => void)[] = [];
  const terminate = jest.fn();
  const instance = {
    ...state,
    terminate,
    addEventListenerOnce: (_event: string, listener: () => void) => closeListeners.push(listener),
  };

  // the pool only hands the lambda to the util, the fake has what the util uses
  return { instance: instance as unknown as Lambda, terminate, close: () => closeListeners.forEach((listener) => listener()) };
};

describe('stopLambdaIfRetired', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each([
    ['is not retiring', { retiring: false, busy: false }],
    ['is busy', { retiring: true, busy: true }],
  ])('leaves a lambda alone that %s', (_name, state) => {
    const { instance, terminate } = createInstance(state);

    stopLambdaIfRetired(instance);
    jest.advanceTimersByTime(STOP_GRACE);

    expect(terminate).not.toHaveBeenCalled();
  });

  it('asks an idle retiring lambda to stop, and kills it when it does not within the grace time', () => {
    const { instance, terminate } = createInstance({ retiring: true, busy: false });

    stopLambdaIfRetired(instance);
    expect(terminate).toHaveBeenCalledWith('SIGTERM');

    jest.advanceTimersByTime(STOP_GRACE);
    expect(terminate).toHaveBeenLastCalledWith('SIGKILL');
  });

  it('does not kill a lambda that closed in time', () => {
    const { instance, terminate, close } = createInstance({ retiring: true, busy: false });

    stopLambdaIfRetired(instance);
    close();
    jest.advanceTimersByTime(STOP_GRACE);

    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
