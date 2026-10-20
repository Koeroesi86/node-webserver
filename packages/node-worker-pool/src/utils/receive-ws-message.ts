import { WORKER_EVENT } from '../constants';
import type { ResponseEvent, WorkerInputEvent, WSFrameEvent } from '../types';
import createEmptyBody from './create-empty-body';
import createWorkerEvent from './create-worker-event';
import invokeWorker from './invoke-worker';
import sendWsMessage from './send-ws-message';
import type { WorkerEnvironment } from './worker-environment';

/** the worker handles a message of a websocket client; the messages of a client are handled one at a time, in the order they came in */
export default function receiveWsMessage(
  env: WorkerEnvironment,
  { requestId, event: { body } }: Extract<WorkerInputEvent, { type: WORKER_EVENT.WS_MESSAGE_RECEIVE }>
) {
  const { contexts, channel, metrics, worker } = env;
  const callback = (responseEvent: ResponseEvent | WSFrameEvent) =>
    'sendWsMessage' in responseEvent
      ? sendWsMessage(env, requestId, contexts.get(requestId)?.webSocket?.stream, responseEvent)
      : console.error(new Error('A websocket message is answered with sendWsMessage.'));
  const acknowledge = () => channel.send({ type: WORKER_EVENT.WS_MESSAGE_ACKNOWLEDGE, requestId });

  // one at a time, so that a message is handled after the one before it, and the server is told when the worker has taken it
  const handled = (contexts.get(requestId)?.receiving ?? Promise.resolve()).then(
    () =>
      new Promise<void>((resolve) => {
        const request = contexts.get(requestId)?.webSocket?.event;
        if (!request) return resolve();

        const event = {
          ...request,
          ...(typeof body === 'string' ? { frame: body } : { binaryFrame: body }),
        };
        invokeWorker(
          worker,
          createWorkerEvent(event, requestId, createEmptyBody(), () => metrics.request(requestId)),
          callback,
          console.error,
          () => {
            acknowledge();
            resolve();
          }
        );
      })
  );
  contexts.open(requestId).receiving = handled;
}
