import type net from 'net';

/**
 * The function that stops libuv from reading a socket, which `socket.pause()` does not do: it only holds back the events, while the bytes of a client that keeps sending
 * are still read, and dropped once the socket is sent to another process. Undefined when this version of node does not have it, the socket is not handed over then.
 * It also tells node that the socket is reading: the http server starts reading again on a resume of a socket it believes to be stopped, and the bytes it reads before the
 * handle is closed are lost to the worker. The function that stopping returns starts reading again, for a socket that was not handed over.
 */
const getReadStop = (socket: net.Socket): (() => () => void) | undefined => {
  const handle: unknown = Reflect.get(socket, '_handle');
  const readStop: unknown = typeof handle === 'object' && handle !== null ? Reflect.get(handle, 'readStop') : undefined;

  if (typeof readStop !== 'function' || typeof handle !== 'object' || handle === null) return undefined;

  return () => {
    Reflect.apply(readStop, handle, []);
    Reflect.set(handle, 'reading', true);

    // for a socket that stays here after all: node starts reading again from the state it believes to be stopped
    return () => {
      Reflect.set(handle, 'reading', false);
      socket.resume();
    };
  };
};

export default getReadStop;
