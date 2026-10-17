import type net from 'net';
import type { RequestHandBackMessage } from '../types';

/** gives the connection of a handed over request back to the server, over the IPC channel of node. Rejects when the server cannot take it, which leaves the connection to the caller. */
const sendHandBack = (message: RequestHandBackMessage, socket: net.Socket) =>
  new Promise<void>((resolve, reject) => {
    if (!process.send || !process.connected) {
      reject(new Error('The worker has no IPC channel.'));
      return;
    }

    process.send(message, socket, (error: Error | null) => (error ? reject(error) : resolve()));
  });

export default sendHandBack;
