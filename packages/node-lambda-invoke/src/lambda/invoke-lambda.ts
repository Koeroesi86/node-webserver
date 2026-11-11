import type { IncomingMessage } from 'http';
import { createBodyForwarder, WORKER_EVENT } from '@koeroesi86/node-worker/pool';
import type { RequestEvent, ResponseMessage, WorkerLease, WorkerOutputEvent } from '@koeroesi86/node-worker/pool';

export type InvocationOutcome =
  { type: 'response'; response: ResponseMessage } | { type: 'closed' } | { type: 'timeout' } | { type: 'tooLarge' } | { type: 'abandoned' };

interface InvokeLambdaParams {
  lease: WorkerLease;
  request: IncomingMessage;
  requestId: string;
  event: RequestEvent;
  /** how long the handler may take, from the moment the request is sent, in milliseconds */
  timeout: number;
  /** the largest body in bytes, 0 for no limit */
  limitRequestBody: number;
}

/**
 * Hands the request to the worker of the lease, streams the body to it as it arrives, and settles with what happens first: its response, its exit, the timeout,
 * a body over the limit, or the client going away before the whole body arrived. A client that goes away after that does not matter, the lambda answers anyway.
 * The lease is not released, which is up to the caller as it may have to kill the worker first.
 */
const invokeLambda = ({ lease, request, requestId, event, timeout, limitRequestBody }: InvokeLambdaParams) =>
  new Promise<InvocationOutcome>((resolve) => {
    /** the worker only runs the handler once it has the whole body */
    let bodyArrived = !event.hasBody;
    const timer = setTimeout(() => settle({ type: 'timeout' }), timeout);
    const forwarder = createBodyForwarder({
      request,
      lease,
      requestId,
      limit: limitRequestBody,
      onTooBig: () => settle({ type: 'tooLarge' }),
      onProgress: () => {},
    });
    const onEnd = () => {
      bodyArrived = true;
      forwarder.end();
    };
    const onClose = () => {
      if (!bodyArrived) settle({ type: 'abandoned' });
    };

    function settle(outcome: InvocationOutcome) {
      clearTimeout(timer);
      request.off('data', forwarder.part);
      request.off('end', onEnd);
      request.off('close', onClose);
      // a worker that is still reading the body stops, the others are done with the request or killed
      if (outcome.type === 'tooLarge' || outcome.type === 'abandoned') lease.send({ type: WORKER_EVENT.REQUEST_ABORT, requestId });
      resolve(outcome);
    }

    lease.subscribe(
      requestId,
      (message: WorkerOutputEvent) => {
        if (message.type === WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE) forwarder.acknowledge();
        if (message.type === WORKER_EVENT.RESPONSE && message.event) settle({ type: 'response', response: message.event });
      },
      () => settle({ type: 'closed' })
    );
    lease.send({ type: WORKER_EVENT.REQUEST, requestId, event });

    if (!event.hasBody) return;

    request.on('data', forwarder.part);
    request.once('end', onEnd);
    request.once('close', onClose);
  });

export default invokeLambda;
