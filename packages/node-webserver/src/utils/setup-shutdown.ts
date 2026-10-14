import type net from 'net';
import addExitListeners from './exitHandler';
import createGracefulStop from './create-graceful-stop';
import type { LoadedInstance, ServerState } from '../types';

interface ShutdownOptions {
  reloadOnSighup: boolean;
  shutdownTimeout: number;
  reload: () => void;
  getLoaded: () => LoadedInstance[];
  getInstances: () => ServerState[];
}

/** Stops the servers softly on SIGINT, SIGTERM and, unless it reloads the configuration, SIGHUP. */
const setupShutdown = (servers: net.Server[], { reloadOnSighup, shutdownTimeout, reload, getLoaded, getInstances }: ShutdownOptions) => {
  const gracefulStop = createGracefulStop(servers, (timeout) => Promise.all(getLoaded().map(({ close }) => close(timeout))).then(() => undefined));
  addExitListeners(getInstances, {
    exitOnHangUp: !reloadOnSighup,
    gracefulStop: () => gracefulStop(shutdownTimeout),
  });
  if (reloadOnSighup) process.on('SIGHUP', reload);
};

export default setupShutdown;
