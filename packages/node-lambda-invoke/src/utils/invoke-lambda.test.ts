import invokeLambda from './invoke-lambda';
import type Lambda from '../classes/Lambda';
import type RequestEvent from '../classes/RequestEvent';
import type ResponseEvent from '../classes/ResponseEvent';

const request = {} as RequestEvent;
const response = {} as ResponseEvent;

const createLambda = (running: boolean) => {
  const closeListeners: (() => void)[] = [];
  const invoke = jest.fn();
  const lambda = {
    running,
    invoke,
    addEventListenerOnce: (_event: string, listener: () => void) => closeListeners.push(listener),
    removeEventListener: jest.fn(),
  };
  return { lambda: lambda as unknown as Lambda, invoke, close: () => closeListeners.forEach((listener) => listener()) };
};

describe('invokeLambda', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('settles with the response of the lambda', async () => {
    const { lambda, invoke } = createLambda(true);
    const outcome = invokeLambda(lambda, 'abc', request, 1000);

    invoke.mock.calls[0][2](response);

    await expect(outcome).resolves.toEqual({ type: 'response', responseEvent: response });
  });

  it('settles as closed when the lambda exits, and as timeout when it takes too long', async () => {
    const closing = createLambda(true);
    const closed = invokeLambda(closing.lambda, 'abc', request, 1000);
    closing.close();
    await expect(closed).resolves.toEqual({ type: 'closed' });

    const slow = invokeLambda(createLambda(true).lambda, 'abc', request, 1000);
    jest.advanceTimersByTime(1000);
    await expect(slow).resolves.toEqual({ type: 'timeout' });
  });

  it('settles as closed at once for a lambda that exited already, without invoking it', async () => {
    const { lambda, invoke } = createLambda(false);

    await expect(invokeLambda(lambda, 'abc', request, 1000)).resolves.toEqual({ type: 'closed' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
