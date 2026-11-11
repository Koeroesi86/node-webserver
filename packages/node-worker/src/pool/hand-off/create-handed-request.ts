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
 * The connection is closed after the response, or when nothing moves on it for `timeout` milliseconds (answered with a 504 when nothing was written yet).
 */
const createHandedRequest = ({ message: { prefix, length, timeout }, socket, onClosed }: HandedRequestParams) => {
  // an error of the connection is a close as well, which is where it is handled
  socket.on('error', () => {});
  const responder = createSocketResponder(socket);
  const bodyStream: Readable = createSocketBody(socket, Buffer.from(prefix, 'base64'), length);
  // the server does not watch the connection any more, so this is the only limit: it counts the time nothing moves on the connection, which a client that is sending does not reach.
  // a client that got no response yet is answered like the server answers a silent worker, the status line of one under way cannot be taken back
  if (timeout > 0) {
    let timedOut = false;
    socket.setTimeout(timeout, async () => {
      if (responder.hasResponded() || timedOut) return socket.destroy();

      timedOut = true;
      await responder.callback({ statusCode: 504, headers: { 'Content-Type': 'text/plain' }, body: 'Worker did not respond in time.' });
      socket.destroy();
    });
  }
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
