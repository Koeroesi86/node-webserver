import { WORKER_EVENT } from './constants';
import { InvokableWorker, ResponseEvent, WorkerInputEvent, WorkerOutputEvent, WSFrameEvent } from './types';

const worker = require(process.argv.pop()) as InvokableWorker;

const internalServerError: ResponseEvent = {
  statusCode: 500,
  headers: { 'Content-Type': 'text/plain' },
  body: 'Internal Server Error',
  isBase64Encoded: false,
};

/** runs the worker, a synchronous throw and a rejected promise end up in the same error handler instead of crashing the process */
function invoke(event: Parameters<InvokableWorker>[0], callback: Parameters<InvokableWorker>[1], onError: (error: unknown) => void) {
  try {
    Promise.resolve(worker(event, callback)).catch(onError);
  } catch (error) {
    onError(error);
  }
}

function messageListener(message: WorkerInputEvent) {
  if (message.type === WORKER_EVENT.REQUEST) {
    process.send({
      type: WORKER_EVENT.REQUEST_ACKNOWLEDGE,
      requestId: message.requestId,
    });
    let responded = false;
    const callback = (responseEvent: ResponseEvent | WSFrameEvent) => {
      let e: WorkerOutputEvent;
      responded = true;

      if ('sendWsMessage' in responseEvent) {
        e = {
          type: WORKER_EVENT.WS_MESSAGE_SEND,
          requestId: message.requestId,
          event: responseEvent,
        };
      } else if ('emit' in responseEvent) {
        e = {
          type: WORKER_EVENT.RESPONSE_EMIT,
          requestId: message.requestId,
          event: responseEvent,
        };
      } else {
        e = {
          type: WORKER_EVENT.RESPONSE,
          requestId: message.requestId,
          event: responseEvent,
        };
      }
      process.send(e);
    };
    invoke(message.event, callback, (error) => {
      console.error(error);
      // a failing worker answers the request instead of leaving it waiting, unless it already did
      if (!responded) {
        callback(internalServerError);
      }
    });
  }

  if (message.type === WORKER_EVENT.WS_MESSAGE_RECEIVE) {
    const callback = (responseEvent) => {
      const e: WorkerOutputEvent = {
        type: WORKER_EVENT.WS_MESSAGE_SEND,
        requestId: message.requestId,
        event: responseEvent,
      };
      process.send(e);
    };
    invoke(message.event, callback, console.error);
  }

  if (message.type === WORKER_EVENT.WS_CONNECTION_CLOSE) {
    invoke(
      { ...message.event, closed: true },
      (responseEvent: ResponseEvent) => {
        process.send({
          type: WORKER_EVENT.WS_CONNECTION_CLOSE_ACKNOWLEDGE,
          requestId: message.requestId,
          event: responseEvent,
        });
      },
      console.error
    );
  }
}

process.on('message', messageListener);

// the parent can disappear without running its exit handlers, for example when it is terminated by a signal
process.on('disconnect', () => process.exit(0));
