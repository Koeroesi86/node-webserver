import { STATUS_CODES, validateHeaderName, validateHeaderValue } from 'http';
import type net from 'net';
import type { HandOffEvent, ResponseEvent, WSFrameEvent } from '../types';

/** the statuses whose response has no body and no length */
const bodylessStatuses = [204, 304];

/** set here, a worker cannot say how the body is framed on a connection that is closed after it */
const ownedHeaders = ['connection', 'transfer-encoding'];

const internalServerError = Buffer.from('Internal Server Error');

const toBuffer = ({ body, isBase64Encoded }: ResponseEvent) =>
  typeof body === 'string' ? Buffer.from(body, isBase64Encoded ? 'base64' : 'utf8') : (body ?? Buffer.alloc(0));

/** how many bytes the body has by the head of the response: none for a status without a body, what `Content-Length` says, or the size the response is known to have. Nothing when the body ends with the connection. */
const getDeclaredLength = (statusCode: number, headers: ResponseEvent['headers'], contentLength: number | undefined) => {
  if (bodylessStatuses.includes(statusCode) || statusCode < 200) return 0;

  const header = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === 'content-length')?.[1];
  const declared = header === undefined ? contentLength : Number([header].flat()[0]);

  return Number.isInteger(declared) && declared !== undefined && declared >= 0 ? declared : undefined;
};

/** the head of a response, the values are checked like node checks the headers of a response, so that a worker cannot inject a line */
const buildHead = (statusCode: number, headers: ResponseEvent['headers'], contentLength: number | undefined, keepAlive: boolean) => {
  const lines = Object.entries(headers ?? {})
    .filter(([name]) => !ownedHeaders.includes(name.toLowerCase()))
    .flatMap(([name, value]) =>
      [value].flat().map((single) => {
        validateHeaderName(name);
        validateHeaderValue(name, single);
        return `${name}: ${single}`;
      })
    );
  const hasLength = Object.keys(headers ?? {}).some((name) => name.toLowerCase() === 'content-length');
  const length =
    hasLength || contentLength === undefined || bodylessStatuses.includes(statusCode) || statusCode < 200 ? [] : [`Content-Length: ${contentLength}`];

  return Buffer.from(
    [`HTTP/1.1 ${statusCode} ${STATUS_CODES[statusCode] ?? ''}`, ...lines, ...length, keepAlive ? 'Connection: keep-alive' : 'Connection: close', '', ''].join(
      '\r\n'
    )
  );
};

interface KeepAlive {
  /** whether the connection can serve another request once this response is done, asked when the head is written */
  isPossible: () => boolean;
  /** the response was written whole: the connection goes on instead of being closed */
  onDone: () => Promise<void>;
}

/**
 * Writes the response of a request whose connection the server handed over: a response in one piece, or in parts as `emit` says, ending with a part without a body.
 * The connection is closed after the response, so a body without a `Content-Length` ends with it, unless `keepAlive` says that the connection goes on: then a response whose size
 * is known up front says so, and `onDone` takes the connection once exactly that many bytes were written. The promise a part returns resolves with `true` once the part was written,
 * and with `false` when the client is gone, like the one of the server does.
 */
const createSocketResponder = (socket: net.Socket, keepAlive?: KeepAlive) => {
  let headWritten = false;
  let ended = false;
  let broken = false;
  let statusCode: number | undefined;
  let bytes = 0;
  let declared: number | undefined;
  let keeping = false;

  const broke = () => {
    broken = true;

    return false;
  };

  const write = (chunk: Buffer) =>
    new Promise<boolean>((resolve) => {
      if (socket.destroyed || !socket.writable) return resolve(broke());

      socket.write(chunk, (error) => resolve(error ? broke() : true));
    });

  const end = () => {
    ended = true;
    socket.end();
    // what the client still sends is read and dropped, a connection that is not read stays stuck
    socket.resume();
  };

  /** the end of a response: the connection goes on when the response was written whole as its head said, otherwise it is closed */
  const finish = async () => {
    if (!keeping || broken || bytes !== declared || socket.destroyed || !socket.writable) return end();

    ended = true;
    return keepAlive?.onDone();
  };

  /** the head of the response, or of a 500 when the worker gave headers that are not valid */
  const prepareHead = (code: number, headers: ResponseEvent['headers'], contentLength?: number) => {
    try {
      declared = getDeclaredLength(code, headers, contentLength);
      keeping = declared !== undefined && keepAlive?.isPossible() === true;
      return { code, head: buildHead(code, headers, contentLength, keeping), failed: false };
    } catch (error) {
      console.error(error);
      keeping = false;
      return { code: 500, head: buildHead(500, { 'Content-Type': 'text/plain' }, internalServerError.length, false), failed: true };
    }
  };

  const respond = async (event: ResponseEvent) => {
    const { code, head, failed } = prepareHead(event.statusCode, event.headers, toBuffer(event).length);
    const body = failed ? internalServerError : toBuffer(event);
    headWritten = true;
    statusCode = code;
    // a response without a body for its status has none, whatever the worker gave
    const sent = bodylessStatuses.includes(code) || code < 200 ? Buffer.alloc(0) : body;
    bytes = sent.length;
    await write(Buffer.concat([head, sent]));
    await finish();
  };

  const emit = async (event: ResponseEvent) => {
    if (!headWritten) {
      const { code, head, failed } = prepareHead(event.statusCode, event.headers);
      headWritten = true;
      statusCode = code;
      await write(head);
      // the worker streams a body for a response that is not the one it meant, the 500 has no body to follow
      if (failed) {
        await write(internalServerError);
        end();
      }
    }
    if (ended) return false;
    if (event.body === null) {
      await finish();
      return true;
    }

    const body = toBuffer(event);
    bytes += body.length;
    return write(body);
  };

  return {
    /** the callback of the worker, an answer after the end is ignored */
    callback: (event: ResponseEvent | HandOffEvent | WSFrameEvent) => {
      // the body is written to the connection through the parts of the response, there is no other one to hand over
      if ('handOff' in event || 'sendWsMessage' in event || ended) return Promise.resolve(undefined);

      return 'emit' in event && event.emit ? emit(event) : respond(event);
    },
    hasResponded: () => headWritten,
    /** how the response went: the status that was written, 0 when none, and the bytes of its body */
    summary: () => ({ statusCode: statusCode ?? 0, bytes }),
  };
};

export default createSocketResponder;
