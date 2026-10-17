import type net from 'net';
import type { Readable } from 'stream';
import type { RequestHandOffMessage, ResponseMessage } from '../types';
import detachConnection from './detach-connection';
import getReadStop from './get-read-stop';
import createSocketBody from './create-socket-body';
import createSocketResponder from './create-socket-responder';

interface HandedRequestParams {
  message: RequestHandOffMessage;
  socket: net.Socket;
  /** the connection is closed: the server frees the worker and logs the response, with the status that was written (0 for none) and the bytes of the body */
  onClosed: (summary: ResponseMessage) => void;
  /**
   * gives the connection back to the server, with how the response went and the bytes read from it behind the body. Without it the connection is closed after every response.
   * It rejects when the connection could not be sent, which closes it.
   */
  onHandBack?: (summary: ResponseMessage, socket: net.Socket, leftover: Buffer) => Promise<void>;
}

/**
 * A request whose connection the server handed over: the body is read from the connection, and the response written to it.
 * The connection is closed after the response, or when the client stops taking or sending for `timeout` milliseconds, unless the server allowed to keep it (`keepAlive`)
 * and the response was written whole with the body read whole: then it goes back to the server for the next request of the client.
 */
const createHandedRequest = ({ message: { prefix, length, timeout, keepAlive }, socket, onClosed, onHandBack }: HandedRequestParams) => {
  // an error of the connection is a close as well, which is where it is handled
  socket.on('error', () => {});
  // the server does not watch the connection any more, a client that stops taking the response would hold the worker forever
  if (timeout > 0) socket.setTimeout(timeout, () => socket.destroy());

  let handedBack = false;
  const body = createSocketBody(socket, Buffer.from(prefix, 'base64'), length);
  const bodyStream: Readable = body.stream;

  const summarize = (): ResponseMessage => {
    const { statusCode, bytes } = responder.summary();

    return { statusCode, headers: { 'Content-Length': `${bytes}` } };
  };

  const handBack = async () => {
    const leftover = Buffer.concat([body.takeLeftover(), detachConnection(socket)]);

    // set before the send, as the socket closes once it was sent and that is not the end of the request
    handedBack = true;
    try {
      await onHandBack?.(summarize(), socket, leftover);
    } catch {
      handedBack = false;
    }
    // the handle is with the server now, or was never sent: this lets the worker let go of the connection, which the server waits for when it closes
    socket.destroy();
  };

  const responder = createSocketResponder(
    socket,
    onHandBack && keepAlive
      ? {
          // the body has to be out of the connection, and libuv has to be stoppable, or a byte of the next request could be lost with the handle
          isPossible: () => body.isComplete() && !socket.destroyed && getReadStop(socket) !== undefined,
          onDone: handBack,
        }
      : undefined
  );
  socket.once('close', () => {
    bodyStream.destroy();
    if (!handedBack) onClosed(summarize());
  });

  return {
    bodyStream,
    respond: responder.callback,
    hasResponded: responder.hasResponded,
  };
};

export default createHandedRequest;
