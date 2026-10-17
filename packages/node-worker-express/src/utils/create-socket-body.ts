import type net from 'net';
import { Readable } from 'stream';

/**
 * The body of a request that is read from the connection of the client: the bytes that had arrived with the head, then the rest from the socket, up to `length` bytes in all.
 * The socket is read at the pace of the reader, and not any more once the body is whole. It ends with an error when the connection closes before the whole body arrived.
 * `isComplete` tells whether the connection holds nothing of the body any more, `takeLeftover` the bytes it read behind it, which are the start of the next request.
 */
const createSocketBody = (socket: net.Socket, prefix: Buffer, length: number) => {
  let remaining = length - prefix.length;
  let leftover: Buffer = Buffer.alloc(0);
  // stated, as the default differs between versions of node, like the stream of a body that travels through the server
  const stream = new Readable({
    highWaterMark: 64 * 1024,
    read: () => remaining > 0 && socket.resume(),
    destroy(error, callback) {
      socket.off('data', onData);
      callback(error);
    },
  });
  // a body that is cut off destroys the stream with an error, which must not take the process down when the worker is not reading it
  stream.on('error', () => {});

  function onData(chunk: Buffer) {
    const part = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    remaining -= part.length;
    // the bytes after the announced length are not part of this request
    if (!stream.push(part)) socket.pause();
    if (remaining > 0) return;

    socket.off('data', onData);
    // what comes next is for whoever gets the connection after this request, a socket that flows without a reader would drop it
    socket.pause();
    leftover = chunk.subarray(part.length);
    stream.push(null);
  }

  socket.pause();
  if (prefix.length > 0) stream.push(prefix);
  if (remaining > 0) {
    socket.on('data', onData);
    socket.once('close', () => remaining > 0 && stream.destroy(new Error('The request was aborted.')));
  } else {
    stream.push(null);
  }

  return {
    stream,
    isComplete: () => remaining <= 0,
    takeLeftover: () => {
      const taken = leftover;
      leftover = Buffer.alloc(0);

      return taken;
    },
  };
};

export default createSocketBody;
