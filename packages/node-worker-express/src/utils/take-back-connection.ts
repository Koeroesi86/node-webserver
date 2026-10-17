import net from 'net';

/** a worker gave the connection of a client back: it goes to the http server it came from, as a new connection that starts with what the worker read from it */
const takeBackConnection = (server: unknown, socket: net.Socket, leftover: Buffer) => {
  if (!(server instanceof net.Server) || !server.listening) {
    socket.destroy();
    return false;
  }

  // like the sockets of the http server, which lets a client that is done sending wait for the response
  socket.allowHalfOpen = true;
  if (leftover.length > 0) socket.unshift(leftover);
  server.emit('connection', socket);

  return true;
};

export default takeBackConnection;
