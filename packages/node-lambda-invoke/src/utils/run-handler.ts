import ResponseEvent from '../classes/ResponseEvent';
import { MESSAGE_INTERNAL_SERVER_ERROR } from '../constants';
import type RequestEvent from '../classes/RequestEvent';
import type { LambdaContext, LambdaHandler } from '../types';

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === 'object' || typeof value === 'function') && value !== null && 'then' in value && typeof value.then === 'function';

/** what AWS answers for a failed function: the details go to the log of the lambda, not to the client */
const failure = (error: unknown) => {
  console.error(error);
  return Object.assign(new ResponseEvent(), {
    statusCode: 502,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: MESSAGE_INTERNAL_SERVER_ERROR }),
  });
};

/** anything but an object is not a response, it is answered with 502 later on as it has no status code */
const toResponseEvent = (response: unknown) => Object.assign(new ResponseEvent(), typeof response === 'object' ? response : undefined);

/**
 * Calls the handler and settles with its response: the promise it returns, or its callback, whichever settles first.
 * A handler that throws, rejects or passes an error to the callback is a failure. The context is made with the callback to give to its `done`.
 */
const runHandler = (
  { handler, thisArg }: { handler: LambdaHandler; thisArg?: unknown },
  event: RequestEvent,
  createContext: (done: (error?: unknown, response?: unknown) => void) => LambdaContext
) =>
  new Promise<ResponseEvent>((resolve) => {
    const callback = (error?: unknown, response?: unknown) => resolve(error ? failure(error) : toResponseEvent(response));

    try {
      const result = handler.call(thisArg, event, createContext(callback), callback);

      if (isPromiseLike(result)) {
        result.then(
          (response) => resolve(toResponseEvent(response)),
          (error) => resolve(failure(error ?? new Error('The handler rejected.')))
        );
      }
    } catch (error) {
      // a handler that throws would take the process, and so the lambda, down with it
      resolve(failure(error));
    }
  });

export default runHandler;
