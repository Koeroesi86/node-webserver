import type { Socket } from 'net';
import { WebSocketCloseCode, WebSocketCloseTimeout, WebSocketOpcode, WebSocketSendBuffer, WebSocketWindow } from '../constants';
import constructWsCloseFrame from './construct-ws-close-frame';
import constructWsFrame from './construct-ws-frame';
import createWsReader from './create-ws-reader';
import WsProtocolError from './ws-protocol-error';

export interface WsConnectionOptions {
  /** the largest message in bytes, 0 for none */
  limitMessage: number;
  /** milliseconds between the pings, 0 for none */
  pingInterval: number;
  /** milliseconds without anything from the client after which the connection is closed, 0 for never */
  idleTimeout: number;
  /** a whole message of the client, to be passed on to the worker. `acknowledge` is called when the worker is done with it. */
  onMessage: (data: string | Buffer) => void;
}

/**
 * The socket of a websocket client, after the worker accepted the upgrade: reads its messages, answers pings and the close, keeps the connection alive and
 * holds both directions to what the other side takes. The client is paused while the worker has not taken the messages it was sent, and what is written to a client
 * that is slow to read is acknowledged only once it was written, so a worker that waits for that cannot fill the memory of the server.
 */
const createWsConnection = (socket: Socket, { limitMessage, pingInterval, idleTimeout, onMessage }: WsConnectionOptions) => {
  const read = createWsReader(limitMessage);
  /** the sizes of the messages the worker has not taken yet, oldest first */
  const unacknowledged: number[] = [];
  let unacknowledgedBytes = 0;
  let opened = false;
  /** the close was started by either side, nothing more is read */
  let closing = false;
  let lastReceived = Date.now();
  let corked = false;
  let closeTimer: NodeJS.Timeout | undefined;
  let keepAliveTimer: NodeJS.Timeout | undefined;

  const isFull = () => unacknowledged.length >= WebSocketWindow.messages || unacknowledgedBytes >= WebSocketWindow.bytes;

  /** the frames written in the same turn of the event loop leave in one write */
  const write = (frame: Buffer, done?: (error?: Error | null) => void) => {
    if (!socket.writable) return done?.(new Error('The connection is closed.'));
    if (!corked) {
      corked = true;
      socket.cork();
      process.nextTick(() => {
        corked = false;
        socket.uncork();
      });
    }
    socket.write(frame, done);
  };

  const close = (code?: number, reason?: string) => {
    if (closing) return;
    closing = true;
    // what is on its way to the worker is not needed any more, the paused socket must also deliver the end of the client
    socket.resume();
    write(constructWsCloseFrame(code, reason));
    socket.end();
    closeTimer = setTimeout(() => socket.destroy(), WebSocketCloseTimeout).unref();
  };

  const handleEvents = (chunk: Buffer) =>
    read(chunk).forEach((event) => {
      if (closing) return;
      if (event.type === 'ping') write(constructWsFrame(WebSocketOpcode.pong, event.data));
      if (event.type === 'close') close(event.code ?? WebSocketCloseCode.normal);
      if (event.type !== 'message') return;

      const size = Buffer.byteLength(event.data);
      unacknowledged.push(size);
      unacknowledgedBytes += size;
      onMessage(event.data);
    });

  const receive = (chunk: Buffer) => {
    if (!opened || closing) return;

    lastReceived = Date.now();
    try {
      handleEvents(chunk);
    } catch (error) {
      if (!(error instanceof WsProtocolError)) throw error;
      close(error.code, error.message);
    }
    if (!closing && isFull()) socket.pause();
  };

  /** the worker took the oldest message it was sent */
  const acknowledge = () => {
    unacknowledgedBytes -= unacknowledged.shift() ?? 0;
    if (!closing && !isFull()) socket.resume();
  };

  /** writes a message to the client, and tells whether it was written. Too much waiting for a client that does not read closes the connection. */
  const send = (data: string | Buffer, done: (written: boolean) => void) => {
    if (closing || socket.destroyed) return done(false);
    if (socket.writableLength > WebSocketSendBuffer) {
      close(WebSocketCloseCode.policy, 'The client reads too slowly.');
      return done(false);
    }

    write(constructWsFrame(typeof data === 'string' ? WebSocketOpcode.text : WebSocketOpcode.binary, data), (error) => done(!error));
  };

  const keepAlive = () => {
    if (closing) return;
    // a client that is paused because the worker is slow is not silent because it is gone
    if (idleTimeout > 0 && !socket.isPaused() && Date.now() - lastReceived >= idleTimeout) {
      close(WebSocketCloseCode.goingAway, 'Idle.');
      return;
    }
    if (pingInterval > 0) write(constructWsFrame(WebSocketOpcode.ping));
  };

  return {
    /** the worker accepted the upgrade, from now on the data of the socket is websocket frames */
    open: () => {
      opened = true;
      lastReceived = Date.now();
      if (pingInterval > 0 || idleTimeout > 0) keepAliveTimer = setInterval(keepAlive, pingInterval || idleTimeout).unref();
    },
    receive,
    acknowledge,
    send,
    close,
    dispose: () => {
      clearInterval(keepAliveTimer);
      clearTimeout(closeTimer);
    },
  };
};

export default createWsConnection;
