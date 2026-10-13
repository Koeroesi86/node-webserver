import type net from 'net';

/**
 * The function that stops libuv from reading a socket, which `socket.pause()` does not do: it only holds back the events, while the bytes of a client that keeps sending
 * are still read, and dropped once the socket is sent to another process. Undefined when this version of node does not have it, the socket is not handed over then.
 */
const getReadStop = (socket: net.Socket): (() => void) | undefined => {
  const handle: unknown = Reflect.get(socket, '_handle');
  const readStop: unknown = typeof handle === 'object' && handle !== null ? Reflect.get(handle, 'readStop') : undefined;

  return typeof readStop === 'function' ? () => void Reflect.apply(readStop, handle, []) : undefined;
};

export default getReadStop;
