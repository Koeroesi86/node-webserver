import type net from 'net';
import getReadStop from './get-read-stop';

/**
 * Stops the worker from reading a connection that goes back to the server, and returns the bytes it had read from it already: they are the start of the next request of the client.
 * What was not read yet stays in the kernel, which libuv stops reading from, for the server to read.
 */
const detachConnection = (socket: net.Socket): Buffer => {
  const stopReading = getReadStop(socket);
  socket.setTimeout(0);
  socket.pause();
  const buffered: Buffer | null = socket.read();
  stopReading?.();

  return buffered ?? Buffer.alloc(0);
};

export default detachConnection;
