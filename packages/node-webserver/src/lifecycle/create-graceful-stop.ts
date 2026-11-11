import { closeWebSockets } from '@koeroesi86/node-worker-express';
import type http from 'http';
import type http2 from 'http2';
import type net from 'net';
import untilIdle from './until-idle';

type StoppableServer = net.Server & Partial<Pick<http.Server, 'closeIdleConnections'>>;

/** how often the connections that became idle while the requests were answered are closed */
const IDLE_SWEEP_INTERVAL = 50;

/**
 * Tracks the connections of the servers from the start, and returns the stop of the process: the servers stop listening and tell the clients to move on,
 * the requests in flight are answered, the websockets are closed with 1001, and what is left after `timeout` milliseconds is cut.
 * `stopBehind` then stops what runs behind the servers, with the time that is left. Nothing is tracked per request, only per connection.
 */
const createGracefulStop = (servers: StoppableServer[], stopBehind: (timeout: number) => Promise<void>) => {
  const sockets = new Set<net.Socket>();
  const sessions = new Set<http2.ServerHttp2Session>();

  servers.forEach((server) => {
    server.on('connection', (socket: net.Socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    server.on('session', (session: http2.ServerHttp2Session) => {
      sessions.add(session);
      session.once('close', () => sessions.delete(session));
    });
  });

  return async (timeout: number) => {
    const startedAt = Date.now();
    servers.forEach((server) =>
      // a request on a connection that stays open tells its client to open a new one, HTTP/2 has no such header and is closed by its session
      server.prependListener('request', (request: http.IncomingMessage, response: http.ServerResponse) => {
        if (request.httpVersionMajor < 2 && !response.headersSent) response.setHeader('Connection', 'close');
      })
    );
    // before the servers stop listening, as that closes the connections that are idle and a websocket counts as one: the frame would not leave
    closeWebSockets();
    await new Promise((resolve) => setImmediate(resolve));
    const closed = Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    // a session is closed once its streams are done
    sessions.forEach((session) => session.close());

    // a connection is idle once the request on it is answered, which nothing is told of here: it would take a listener on every request
    const sweep = setInterval(() => servers.forEach((server) => server.closeIdleConnections?.()), IDLE_SWEEP_INTERVAL);
    sweep.unref();
    await untilIdle(() => closed.then(() => undefined), timeout);
    clearInterval(sweep);

    sessions.forEach((session) => session.destroy());
    sockets.forEach((socket) => socket.destroy());
    await stopBehind(Math.max(0, timeout - (Date.now() - startedAt)));
  };
};

export default createGracefulStop;
