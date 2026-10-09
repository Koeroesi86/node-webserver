import net from 'net';
import { Readable } from 'stream';
import { WORKER_EVENT } from './constants';
import { InvokableWorker, RequestBodyEvent, RequestEvent, ResponseEvent, WorkerInputEvent, WorkerOutputEvent, WorkerRequestEvent, WSFrameEvent } from './types';
import createChannel from './utils/createChannel';
import type { ServerMetrics } from './utils/metrics';

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

/** the socket pair to the server, which the pool opens as the fourth stdio of the worker */
const channelSocket = new net.Socket({ fd: 3, readable: true, writable: true });
const channel = createChannel<WorkerInputEvent, WorkerOutputEvent>(channelSocket, messageListener);

/** the body goes over the channel as bytes, which spares the server decoding base64 */
const toMessage = ({ isBase64Encoded, body, ...rest }: ResponseEvent) => ({
  ...rest,
  body: typeof body === 'string' ? Buffer.from(body, isBase64Encoded ? 'base64' : 'utf8') : body,
});

/** the streamed request bodies that are still coming in, per request */
const uploads = new Map<string, { stream: Readable; receive: (part: RequestBodyEvent) => void }>();

/** the workers that wait for the metrics of the server, per request: the answers come in the order of the questions */
const metricsWaiting = new Map<string, Array<(metrics: ServerMetrics) => void>>();

const getMetrics = (requestId: string) =>
  new Promise<ServerMetrics>((resolve) => {
    metricsWaiting.set(requestId, [...(metricsWaiting.get(requestId) ?? []), resolve]);
    channel.send({ type: WORKER_EVENT.METRICS_REQUEST, requestId });
  });

/** the body of a request that has none */
const createEmptyBody = () =>
  new Readable({
    read() {
      this.push(null);
    },
  });

/** the stream of the body of a request: the parts that follow, the one that came with the request, or no bytes */
const createBodyStream = ({ hasBody, inlineBody }: RequestEvent, requestId: string) => {
  if (hasBody) return createUpload(requestId);

  return inlineBody ? Readable.from([Buffer.from(inlineBody, 'base64')], { objectMode: false }) : createEmptyBody();
};

/** what a worker is called with, the websocket frames and the closing of a connection too */
const toWorkerEvent = (event: RequestEvent, requestId: string, bodyStream: Readable): WorkerRequestEvent => ({
  ...event,
  bodyStream,
  getMetrics: () => getMetrics(requestId),
});

/**
 * The stream a worker reads a streamed request body from. A part is acknowledged once the reader has room for it,
 * so the server sends no more than a few parts ahead of what the worker has processed.
 */
function createUpload(requestId: string): Readable {
  /** parts that were put into the stream but not acknowledged yet, as the reader was behind */
  let owed = 0;
  const acknowledge = () => channel.send({ type: WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE, requestId });

  const stream = new Readable({
    // stated, as it is what decides how far the reader may fall behind before the acknowledgements stop, and the default differs between versions of node
    highWaterMark: 64 * 1024,
    read() {
      for (; owed > 0; owed -= 1) acknowledge();
    },
    destroy(error, callback) {
      uploads.delete(requestId);
      callback(error);
    },
  });
  // an upload that is cut off destroys the stream with an error, which must not take the process down when the worker is not reading it
  stream.on('error', () => {});

  uploads.set(requestId, {
    stream,
    receive: ({ body }) => {
      if (body === null) {
        uploads.delete(requestId);
        stream.push(null);
      } else if (stream.push(body)) {
        acknowledge();
      } else {
        owed += 1;
      }
    },
  });

  return stream;
}

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

  if (message.type === WORKER_EVENT.REQUEST_BODY) {
    uploads.get(message.requestId)?.receive(message.event);
  }

  if (message.type === WORKER_EVENT.METRICS) {
    metricsWaiting.get(message.requestId)?.shift()?.(message.event);
  }

  if (message.type === WORKER_EVENT.REQUEST_ABORT) {
    uploads.get(message.requestId)?.stream.destroy(new Error('The request was aborted.'));
    const stream = streams.get(message.requestId);
    if (stream) {
      stream.aborted = true;
      stream.waiting.splice(0).forEach((resolve) => resolve(false));
    }
  }

  if (message.type === WORKER_EVENT.REQUEST) {
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
          event: toMessage(responseEvent),
        };
      } else {
        e = {
          type: WORKER_EVENT.RESPONSE,
          requestId: message.requestId,
          event: toMessage(responseEvent),
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

      channel.send(e);

      // once the response is complete the server drops the rest of the request body, so the stream has nothing more to give
      if (e.type === WORKER_EVENT.RESPONSE || (e.type === WORKER_EVENT.RESPONSE_EMIT && e.event?.body === null)) {
        uploads.get(message.requestId)?.stream.destroy();
        metricsWaiting.delete(message.requestId);
      }

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
      toWorkerEvent(message.event, message.requestId, createBodyStream(message.event, message.requestId)),
      callback,
      (error) => {
        console.error(error);
        // a failing worker answers the request instead of leaving it waiting, unless it already did
        if (!responded) {
          callback(internalServerError);
        }
      },
      // a worker that answered without streaming is done, one that still streams cleans up after its last part
      () => {
        metricsWaiting.delete(message.requestId);
        return stream.waiting.length === 0 && streams.delete(message.requestId);
      }
    );
  }

  if (message.type === WORKER_EVENT.WS_MESSAGE_RECEIVE) {
    const callback = (responseEvent) => {
      const e: WorkerOutputEvent = {
        type: WORKER_EVENT.WS_MESSAGE_SEND,
        requestId: message.requestId,
        event: responseEvent,
      };
      channel.send(e);
    };
    invoke(toWorkerEvent(message.event, message.requestId, createEmptyBody()), callback, console.error);
  }

  if (message.type === WORKER_EVENT.WS_CONNECTION_CLOSE) {
    invoke(
      toWorkerEvent({ ...message.event, closed: true }, message.requestId, createEmptyBody()),
      (responseEvent: ResponseEvent) => {
        channel.send({
          type: WORKER_EVENT.WS_CONNECTION_CLOSE_ACKNOWLEDGE,
          requestId: message.requestId,
          event: toMessage(responseEvent),
        });
      },
      console.error,
      // the connection is closed, nothing will ask the worker for metrics through it any more
      () => metricsWaiting.delete(message.requestId)
    );
  }
}

// the parent can disappear without running its exit handlers, for example when it is terminated by a signal, which closes the channel
channelSocket.on('close', () => process.exit(0));
