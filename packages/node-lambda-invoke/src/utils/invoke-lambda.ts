import type Lambda from '../classes/Lambda';
import type RequestEvent from '../classes/RequestEvent';
import type ResponseEvent from '../classes/ResponseEvent';

export type InvocationOutcome = { type: 'response'; responseEvent: ResponseEvent } | { type: 'closed' } | { type: 'timeout' };

/** hands the request to the lambda, settles with its response, or when the lambda exits, or when it took longer than the timeout */
const invokeLambda = (lambda: Lambda, requestId: string, requestEvent: RequestEvent, timeout: number) =>
  new Promise<InvocationOutcome>((resolve) => {
    const settle = (outcome: InvocationOutcome) => {
      clearTimeout(timer);
      lambda.removeEventListener('close', closeListener);
      resolve(outcome);
    };
    const closeListener = () => settle({ type: 'closed' });
    const timer = setTimeout(() => settle({ type: 'timeout' }), timeout);

    lambda.addEventListenerOnce('close', closeListener);
    lambda.invoke(requestId, requestEvent, (responseEvent) => settle({ type: 'response', responseEvent }), timeout);
  });

export default invokeLambda;
