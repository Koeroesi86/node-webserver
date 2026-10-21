import { Readable } from 'stream';
import { WORKER_EVENT } from '../constants';
import type { WorkerOutputEvent } from '../types';
import type { Channel } from './create-channel';
import type { RequestContexts } from './create-request-contexts';

/**
 * The stream a worker reads a streamed request body from. A part is acknowledged once the reader has room for it,
 * so the server sends no more than a few parts ahead of what the worker has processed.
 */
export default function createUpload(contexts: RequestContexts, channel: Channel<WorkerOutputEvent>, requestId: string): Readable {
  /** parts that were put into the stream but not acknowledged yet, as the reader was behind */
  let owed = 0;
  const acknowledge = () => channel.send({ type: WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE, requestId });
  const forget = () =>
    contexts.change(requestId, (context) => {
      context.upload = undefined;
    });

  const stream = new Readable({
    // stated, as it is what decides how far the reader may fall behind before the acknowledgements stop, and the default differs between versions of node
    highWaterMark: 64 * 1024,
    read() {
      for (; owed > 0; owed -= 1) acknowledge();
    },
    destroy(error, callback) {
      forget();
      callback(error);
    },
  });
  // an upload that is cut off destroys the stream with an error, which must not take the process down when the worker is not reading it
  stream.on('error', () => {});

  contexts.open(requestId).upload = {
    stream,
    receive: ({ body }) => {
      if (body === null) {
        forget();
        // eslint-disable-next-line no-restricted-syntax -- pushing null is how a readable ends
        stream.push(null);
      } else if (stream.push(body)) {
        acknowledge();
      } else {
        owed += 1;
      }
    },
  };

  return stream;
}
