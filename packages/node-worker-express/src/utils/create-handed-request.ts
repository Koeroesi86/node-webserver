import type net from 'net';
import type { Readable } from 'stream';
import type { RequestHandOffMessage, ResponseMessage } from '../types';
import createSocketBody from './create-socket-body';
import createSocketResponder from './create-socket-responder';

interface HandedRequestParams {
  message: RequestHandOffMessage;
  socket: net.Socket;
  /** the connection is closed: the server frees the worker and logs the response, with the status that was written (0 for none) and the bytes of the body */
  onClosed: (summary: ResponseMessage) => void;
}

/**
 * A request whose connection the server handed over: the body is read from the connection, and the response written to it.
 * The connection is closed after the response, or when the client stops taking or sending for `timeout` milliseconds.
 */
const createHandedRequest = ({ message: { prefix, length, timeout }, socket, onClosed }: HandedRequestParams) => {
  // an error of the connection is a close as well, which is where it is handled
  socket.on('error', () => {});
  // the server does not watch the connection any more, a client that stops taking the response would hold the worker forever
  if (timeout > 0) socket.setTimeout(timeout, () => socket.destroy());

  const responder = createSocketResponder(socket);
  const bodyStream: Readable = createSocketBody(socket, Buffer.from(prefix, 'base64'), length);
  socket.once('close', () => {
    const { statusCode, bytes } = responder.summary();
    bodyStream.destroy();
    onClosed({ statusCode, headers: { 'Content-Length': `${bytes}` } });
  });

  return {
    bodyStream,
    respond: responder.callback,
    hasResponded: responder.hasResponded,
  };
};

export default createHandedRequest;
