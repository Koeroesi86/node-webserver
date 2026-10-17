import net from 'net';
import type { Response } from 'express';

/**
 * whether a connection that goes to a worker may come back for the next request of the client: the client wants it kept, nothing told it to move on (the graceful stop of the server
 * does with a header), and the http server that accepted it still accepts connections
 */
const canKeepConnection = (response: Response, server: unknown) =>
  response.shouldKeepAlive === true && `${response.getHeader('connection')}`.toLowerCase() !== 'close' && server instanceof net.Server && server.listening;

export default canKeepConnection;
