import type { IncomingMessage } from 'http';
import RequestBodyTooLargeError from '../classes/RequestBodyTooLargeError';

/**
 * Reads the body of a request into memory, `undefined` when there is none.
 * Rejects with a RequestBodyTooLargeError as soon as the body is known to be larger than the limit (0 for no limit), without reading the rest of it,
 * and with the error of the request when the client goes away halfway.
 */
const readRequestBody = (request: IncomingMessage, limit: number) =>
  new Promise<Buffer | undefined>((resolve, reject) => {
    if (limit > 0 && Number(request.headers['content-length']) > limit) {
      reject(new RequestBodyTooLargeError(`The body is larger than ${limit} bytes.`));
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;

      if (limit > 0 && size > limit) {
        request.off('data', onData);
        request.pause();
        reject(new RequestBodyTooLargeError(`The body is larger than ${limit} bytes.`));
        return;
      }

      chunks.push(chunk);
    };

    request.on('data', onData);
    request.once('end', () => resolve(size === 0 ? undefined : Buffer.concat(chunks, size)));
    request.once('error', reject);
    request.once('close', () => reject(new Error('The client went away before the body was complete.')));
  });

export default readRequestBody;
