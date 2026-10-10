import type { ResponseCallback, ResponseEvent, StreamBody, StreamResponseOptions } from './types';

const proceeds = (result: unknown) => result !== false;

/**
 * Streams the body of a response in parts through the emit protocol of the worker, instead of answering in one message.
 * Parts are only sent a few at a time: the middleware acknowledges a part once it was written to the client, so a slow client
 * slows the source down and the memory stays flat. Nothing is sent after the client is gone.
 *
 * Resolves with `true` when the whole body was sent and `false` when the client went away first. An error of the source ends the response early,
 * which the client sees as a truncated one, as the headers are out by then.
 *
 * Use it from a worker: `await streamResponse(callback, { headers: { 'Content-Type': 'text/plain' } }, someReadableOrAsyncGenerator)`
 */
async function streamResponse(
  callback: ResponseCallback,
  { statusCode = 200, headers = {}, window = Infinity, windowBytes = 4 * 1024 * 1024 }: StreamResponseOptions,
  body: StreamBody
): Promise<boolean> {
  const written: Array<Promise<unknown>> = [];
  const sizes: number[] = [];
  let inFlight = 0;
  const send = (part: Partial<ResponseEvent>) => Promise.resolve(callback({ statusCode, headers, emit: true, ...part }));
  let completed = true;

  try {
    for await (const chunk of body) {
      // a copy: the bytes leave with the next write to the channel, and the source may reuse its buffer by then
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.concat([chunk]);
      // an empty part would look like the end for nobody, but it is a message that has to be acknowledged for nothing
      if (buffer.length === 0) continue;

      written.push(send({ body: buffer }));
      sizes.push(buffer.length);
      inFlight += buffer.length;
      // the oldest part is awaited until both the number of parts and the bytes in flight are within the window
      while (written.length > 0 && (written.length >= window || inFlight >= windowBytes)) {
        inFlight -= sizes.shift() ?? 0;
        if (!proceeds(await written.shift())) {
          completed = false;
          return false;
        }
      }
    }
  } catch (error) {
    console.error(error);
    completed = false;
  } finally {
    // leaving the loop early makes an async generator run its cleanup, a stream has to be told
    if ('destroy' in body && typeof body.destroy === 'function') body.destroy();
  }

  // the last part, without a body, ends the response
  written.push(send({ body: null }));
  const results = await Promise.all(written);

  return completed && results.every(proceeds);
}

/** required by its file path in the workers (`dist/streamResponse`), so it has to stay a CommonJS `module.exports` */
export = streamResponse;
