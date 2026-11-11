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

/** the head of a response, the values are checked like node checks the headers of a response, so that a worker cannot inject a line */
const buildHead = (statusCode: number, headers: ResponseEvent['headers'], contentLength: number | undefined) => {
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

  return Buffer.from([`HTTP/1.1 ${statusCode} ${STATUS_CODES[statusCode] ?? ''}`, ...lines, ...length, 'Connection: close', '', ''].join('\r\n'));
};

/**
 * Writes the response of a request whose connection the server handed over: a response in one piece, or in parts as `emit` says, ending with a part without a body.
 * The connection is closed after the response, so a body without a `Content-Length` ends with it. The promise a part returns resolves with `true` once the part was written,
 * and with `false` when the client is gone, like the one of the server does.
 */
const createSocketResponder = (socket: net.Socket) => {
  let headWritten = false;
  let ended = false;
  let statusCode: number | undefined;
  let bytes = 0;

  const write = (chunk: Buffer) =>
    new Promise<boolean>((resolve) => {
      if (socket.destroyed || !socket.writable) return resolve(false);

      socket.write(chunk, (error) => resolve(!error));
    });

  const end = () => {
    ended = true;
    socket.end();
    // what the client still sends is read and dropped, a connection that is not read stays stuck
    socket.resume();
  };

  /** the head of the response, or of a 500 when the worker gave headers that are not valid */
  const prepareHead = (code: number, headers: ResponseEvent['headers'], contentLength?: number) => {
    try {
      return { code, head: buildHead(code, headers, contentLength), failed: false };
    } catch (error) {
      console.error(error);
      return { code: 500, head: buildHead(500, { 'Content-Type': 'text/plain' }, internalServerError.length), failed: true };
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
    end();
  };

  const emitHead = async (event: ResponseEvent) => {
    const { code, head, failed } = prepareHead(event.statusCode, event.headers);
    headWritten = true;
    statusCode = code;
    await write(head);
    if (!failed) return;
    // the worker streams a body for a response that is not the one it meant, the 500 has no body to follow
    await write(internalServerError);
    end();
  };

  const emit = async (event: ResponseEvent) => {
    if (!headWritten) await emitHead(event);
    if (ended) return false;
    if (event.body === null) {
      end();
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
