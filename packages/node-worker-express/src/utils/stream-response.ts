import type { ResponseCallback, ResponseEvent, StreamBody, StreamResponseOptions } from '@koeroesi86/node-worker/pool';
import { Socket } from 'node:net';
import { pipeline } from 'node:stream/promises';
import forEachWhile from './for-each-while';

const proceeds = (result: unknown) => result !== false;

/** what a client that goes away or a closed connection fails a write with, which is not an error of the source */
const connectionErrors = ['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET', 'EPIPE'];

/** the body goes straight to the connection of the client, with the backpressure of the socket, which is closed after it */
const writeToSocket = (socket: Socket, body: StreamBody) =>
  pipeline(body, socket).then(
    () => {
      socket.destroySoon();
      return true;
    },
    (error: unknown) => {
      if (!(error instanceof Error && 'code' in error && connectionErrors.includes(`${error.code}`))) console.error(error);
      socket.destroy();
      return false;
    }
  );

/** leaving the loop early makes an async generator run its cleanup, a stream has to be told */
const destroyBody = (body: StreamBody) => {
  if ('destroy' in body && typeof body.destroy === 'function') body.destroy();
};

/**
 * Streams the body of a response in parts through the emit protocol of the worker, instead of answering in one message.
 * Parts are only sent a few at a time: the middleware acknowledges a part once it was written to the client, so a slow client
 * slows the source down and the memory stays flat. Nothing is sent after the client is gone.
 *
 * Resolves with `true` when the whole body was sent and `false` when the client went away first. An error of the source ends the response early,
 * which the client sees as a truncated one, as the headers are out by then.
 *
 * A response with a `Content-Length` header asks the server for the connection of the client first. When the server hands it over, the worker writes the body to the client
 * itself, and the bytes do not pass through the server, which then is not the limit of how fast big files are sent. Otherwise the body is streamed through the server as described.
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

  const hasLength = Object.keys(headers).some((name) => name.toLowerCase() === 'content-length');
  const socket = hasLength ? await callback({ statusCode, headers, handOff: true }) : undefined;
  if (socket instanceof Socket) {
    const sent = await writeToSocket(socket, body);
    // the server waits for the end to free the worker
    // eslint-disable-next-line no-restricted-syntax -- a body of null is the end of the response in the protocol of the worker
    return proceeds(await send({ body: null })) && sent;
  }
  const isFull = () => written.length > 0 && (written.length >= window || inFlight >= windowBytes);
  const settleOldest = async () => {
    inFlight -= sizes.shift() ?? 0;
    return proceeds(await written.shift());
  };
  // the oldest part is awaited until both the number of parts and the bytes in flight are within the window, false when the client went away
  const drain = async (): Promise<boolean> => !isFull() || ((await settleOldest()) && drain());

  const writeChunk = async (chunk: string | Buffer | Uint8Array) => {
    // a copy: the bytes leave with the next write to the channel, and the source may reuse its buffer by then
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.concat([chunk]);
    // an empty part would look like the end for nobody, but it is a message that has to be acknowledged for nothing
    if (buffer.length === 0) return true;

    written.push(send({ body: buffer }));
    sizes.push(buffer.length);
    inFlight += buffer.length;
    return drain();
  };

  // false when the client went away, an error of the source only ends the response early
  const sendParts = async () => {
    try {
      return await forEachWhile(body, writeChunk);
    } catch (error) {
      console.error(error);
      completed = false;
      return true;
    } finally {
      destroyBody(body);
    }
  };

  if (!(await sendParts())) return false;

  // the last part, without a body, ends the response
  // eslint-disable-next-line no-restricted-syntax -- a body of null is the end of the response in the protocol of the worker
  written.push(send({ body: null }));
  const results = await Promise.all(written);

  return completed && results.every(proceeds);
}

/** the workers get it as `require('@koeroesi86/node-worker-express').streamResponse`, which is this function, so it stays a CommonJS `module.exports` */
export = streamResponse;
