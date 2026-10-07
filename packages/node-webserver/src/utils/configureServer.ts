import { registerMetricsSource } from '@koeroesi86/node-worker-express';
import { DEFAULT_KEEP_ALIVE_TIMEOUT, DEFAULT_MAX_CONNECTIONS } from '../constants';
import type http from 'http';
import type https from 'https';
import type { Configuration } from '../types';

/**
 * Applies the connection settings to a server, and lists its connections in the metrics under `connections:<name>`: how many are open,
 * how many were dropped for the limit, and the settings.
 */
const configureServer = (
  server: http.Server | https.Server,
  name: string,
  { keepAliveTimeout = DEFAULT_KEEP_ALIVE_TIMEOUT, maxConnections = DEFAULT_MAX_CONNECTIONS }: Pick<Configuration, 'keepAliveTimeout' | 'maxConnections'>
) => {
  server.keepAliveTimeout = keepAliveTimeout;
  // node wants the time for the headers to be longer than the keep-alive time, otherwise it may close a connection that a client is just reusing
  server.headersTimeout = Math.max(server.headersTimeout, keepAliveTimeout + 1000);
  // node counts 0 as a limit that no connection fits under
  server.maxConnections = maxConnections > 0 ? maxConnections : Infinity;

  let open = 0;
  let dropped = 0;
  server.on('connection', (socket) => {
    open += 1;
    socket.once('close', () => {
      open -= 1;
    });
  });
  server.on('drop', () => {
    dropped += 1;
  });

  registerMetricsSource(`connections:${name}`, () => ({ open, dropped, maxConnections, keepAliveTimeout }));
};

export default configureServer;
