import net from 'net';
import type { HandOffEvent } from '../types';

/**
 * The requests of a worker that asked for the connection of their client, until the server sends it or refuses.
 * `ask` tells the server what the response looks like, the connection itself arrives over the IPC channel of node, which can carry it, the socket pair cannot.
 */
export default function createHandOffRequests(ask: (requestId: string, head: HandOffEvent) => void) {
  const waiting = new Map<string, (socket?: net.Socket) => void>();
  /** the connections whose head promised the client that they go on, until the worker gives them back or closes them */
  const kept = new WeakSet<net.Socket>();

  return {
    /** resolves with the connection of the client, or with nothing when the server keeps it and the body has to be streamed through it, or the request is aborted already */
    request: (requestId: string, aborted: boolean, head: HandOffEvent) =>
      aborted
        ? Promise.resolve(undefined)
        : new Promise<net.Socket | undefined>((resolve) => {
            waiting.set(requestId, (socket) => {
              waiting.delete(requestId);
              resolve(socket);
            });
            ask(requestId, head);
          }),

    /** ends the wait without a connection: the server refused it, or the request was aborted */
    settle: (requestId: string) => waiting.get(requestId)?.(),

    /** whether the head of the response told the client that the connection goes on, asked once the body was written */
    takeKeepAlive: (socket: net.Socket) => kept.delete(socket),

    /** takes the connection that came with a message of the server */
    receive: (message: unknown, socket: unknown) => {
      if (typeof message !== 'object' || message === null || !('requestId' in message) || typeof message.requestId !== 'string') return;
      if (!(socket instanceof net.Socket)) return;

      const take = waiting.get(message.requestId);
      if (!take) {
        // nobody waits for it any more, the request was aborted in the meantime
        socket.destroy();
        return;
      }

      if ('keepAlive' in message && message.keepAlive === true) kept.add(socket);
      const timeout = 'timeout' in message && typeof message.timeout === 'number' ? message.timeout : 0;
      // the server does not watch the connection any more, a client that stops taking the body would hold the worker forever
      if (timeout > 0) socket.setTimeout(timeout, () => socket.destroy());
      take(socket);
    },
  };
}
