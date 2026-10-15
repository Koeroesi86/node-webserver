import { ChannelMaxFrameLength, InternalServerError, WORKER_EVENT } from '../constants';
import type { ResponseEvent } from '../types';
import type { Stream } from './create-request-contexts';
import toResponseMessage from './to-response-message';
import type { WorkerEnvironment } from './worker-environment';

/** how the response of a request leaves the worker: in one message, or in parts that wait for the acknowledgement of the parent */
export default function createResponseSender({ channel, isWritable, contexts, metrics }: WorkerEnvironment) {
  /** whether the message was too big for a frame: the request fails alone, instead of the channel and with it the other requests of the worker */
  const isTooBig = (requestId: string, sent: boolean) => {
    if (sent || !isWritable()) return false;

    console.error(new Error(`A response of ${requestId} is bigger than the ${ChannelMaxFrameLength} bytes a message may have, stream it instead.`));
    return true;
  };

  /** once the response is complete the server drops the rest of the request body, so the stream has nothing more to give */
  const finishRequest = (requestId: string) => {
    contexts.get(requestId)?.upload?.stream.destroy();
    metrics.clear(requestId);
  };

  return {
    /** a response in one message */
    sendResponse: (requestId: string, responseEvent: ResponseEvent) => {
      contexts.change(requestId, (context) => {
        context.stream = undefined;
        // an answer that is not the upgrade ends the request, the connection does not become a websocket
        if (responseEvent.statusCode !== 101) context.webSocket = undefined;
      });

      if (isTooBig(requestId, channel.send({ type: WORKER_EVENT.RESPONSE, requestId, event: toResponseMessage(responseEvent) }))) {
        channel.send({ type: WORKER_EVENT.RESPONSE, requestId, event: toResponseMessage(InternalServerError) });
      }
      finishRequest(requestId);

      return undefined;
    },

    /** a part of a streamed response, the promise settles once the parent has written it, and with false when the client is gone */
    sendResponsePart: (requestId: string, stream: Stream, responseEvent: ResponseEvent) => {
      if (stream.aborted) return Promise.resolve(false);

      // a worker can start streaming after its function returned, the acknowledgements still have to find the stream
      contexts.open(requestId).stream = stream;
      if (isTooBig(requestId, channel.send({ type: WORKER_EVENT.RESPONSE_EMIT, requestId, event: toResponseMessage(responseEvent) })))
        return Promise.resolve(false);

      const isLast = responseEvent.body === null;
      if (isLast) finishRequest(requestId);

      return new Promise<boolean>((resolve) => {
        stream.waiting.push((proceed) => {
          if (isLast)
            contexts.change(requestId, (context) => {
              context.stream = undefined;
            });
          resolve(proceed);
        });
      });
    },
  };
}
