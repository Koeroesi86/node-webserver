import type { IncomingMessage } from 'http';

/**
 * The body of a request, if all of it has already arrived and it is not bigger than the limit, taken out of the request. `undefined` when it has to be streamed:
 * when parts of it are still to come, or when it is bigger. Nothing is taken then, the request can still be read as usual.
 * An empty body is a body of no bytes. A limit of 0 never takes any.
 *
 * The length that the request announces tells whether all of it is there. A body without a length (sent in chunks) is there once the parser has seen its end.
 */
const takeSmallBody = (request: IncomingMessage, limit: number): Buffer | undefined => {
  if (limit <= 0) {
    return undefined;
  }

  const announced = request.headers['content-length'] === undefined ? Number.NaN : Number(request.headers['content-length']);

  if (Number.isInteger(announced) && announced >= 0) {
    if (announced > limit || request.readableLength < announced) return undefined;

    return announced === 0 ? Buffer.alloc(0) : request.read(announced);
  }

  // `complete` is set when the parser has seen the end of the body, which then sits in the buffer of the request: a body that is cut off is not complete
  return request.complete && request.readableLength <= limit ? request.read() ?? Buffer.alloc(0) : undefined;
};

export default takeSmallBody;
