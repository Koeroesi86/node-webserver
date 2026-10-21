import type { IncomingMessage } from 'http';
import takeSmallBody from './take-small-body';

/**
 * Decides how the body of a request reaches the worker: along with the request when it has all arrived and is small, as parts that follow otherwise.
 * `wantsBody` is false for a request without a body, or for one that no worker answers, as the static worker has no use for a body (node drops what is not read when the response is done).
 */
const prepareRequestBody = async (request: IncomingMessage, wantsBody: boolean, inlineLimit: number) => {
  if (!wantsBody) return { inlineBody: undefined, streamsBody: false };

  // The headers and the first part of the body can come in one chunk, which the parser reads to its end after it told this handler about the request, so what has
  // arrived is only known after that. When the way was found without waiting, a turn of the event loop has to go by (a microtask is not enough, it runs in between).
  await new Promise((resolve) => setImmediate(resolve));
  // a body that has arrived with the request and is small goes along with it, which spares the messages of a stream for what is often a few bytes
  const inlineBody = takeSmallBody(request, inlineLimit);

  return { inlineBody, streamsBody: inlineBody === undefined };
};

export default prepareRequestBody;
