import { WORKER_EVENT } from './constants';
import { InvokableWorker, ResponseEvent, WorkerInputEvent, WorkerOutputEvent, WSFrameEvent } from './types';

const worker = require(process.argv.pop()) as InvokableWorker;

const internalServerError: ResponseEvent = {
  statusCode: 500,
  headers: { 'Content-Type': 'text/plain' },
  body: 'Internal Server Error',
  isBase64Encoded: false,
};

/** the parts of a streamed response that wait to be written by the parent, per request */
interface Stream {
  waiting: Array<(proceed: boolean) => void>;
  aborted: boolean;
}

const streams = new Map<string, Stream>();

/** runs the worker, a synchronous throw and a rejected promise end up in the same error handler instead of crashing the process */
function invoke(event: Parameters<InvokableWorker>[0], callback: Parameters<InvokableWorker>[1], onError: (error: unknown) => void, onSettled = () => {}) {
  try {
    Promise.resolve(worker(event, callback)).catch(onError).finally(onSettled);
  } catch (error) {
    onError(error);
    onSettled();
  }
}

function messageListener(message: WorkerInputEvent) {
  if (message.type === WORKER_EVENT.RESPONSE_ACKNOWLEDGE) {
    streams.get(message.requestId)?.waiting.shift()?.(true);
  }

  if (message.type === WORKER_EVENT.REQUEST_ABORT) {
    const stream = streams.get(message.requestId);
    if (stream) {
      stream.aborted = true;
      stream.waiting.splice(0).forEach((resolve) => resolve(false));
    }
  }

  if (message.type === WORKER_EVENT.REQUEST) {
    process.send({
      type: WORKER_EVENT.REQUEST_ACKNOWLEDGE,
      requestId: message.requestId,
    });
    let responded = false;
    const stream: Stream = { waiting: [], aborted: false };
    streams.set(message.requestId, stream);

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
        streams.delete(message.requestId);
      }

      if (stream.aborted && e.type === WORKER_EVENT.RESPONSE_EMIT) {
        return Promise.resolve(false);
      }

      if (e.type === WORKER_EVENT.RESPONSE_EMIT) {
        // a worker can start streaming after its function returned, the acknowledgements still have to find the stream
        streams.set(message.requestId, stream);
      }

      process.send(e);

      if (e.type !== WORKER_EVENT.RESPONSE_EMIT) {
        return undefined;
      }

      // the promise settles once the parent has written the part, and with false when the client is gone
      return new Promise<boolean>((resolve) => {
        const isLast = 'body' in responseEvent && responseEvent.body === null;
        stream.waiting.push((proceed) => {
          if (isLast) {
            streams.delete(message.requestId);
          }
          resolve(proceed);
        });
      });
    };

    invoke(
      message.event,
      callback,
      (error) => {
        console.error(error);
        // a failing worker answers the request instead of leaving it waiting, unless it already did
        if (!responded) {
          callback(internalServerError);
        }
      },
      // a worker that answered without streaming is done, one that still streams cleans up after its last part
      () => stream.waiting.length === 0 && streams.delete(message.requestId)
    );
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
