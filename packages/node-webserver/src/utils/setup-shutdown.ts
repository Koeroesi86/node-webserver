import type net from 'net';
import addExitListeners from './exitHandler';
import createGracefulStop from './create-graceful-stop';
import type { LoadedInstance, Logger, ServerState } from '../types';

export interface ShutdownOptions {
  reloadOnSighup: boolean;
  shutdownTimeout: number;
  reload: () => void;
  getLoaded: () => LoadedInstance[];
  getInstances: () => ServerState[];
  logger: Logger;
}

/** Stops the servers softly on SIGINT, SIGTERM and, unless it reloads the configuration, SIGHUP. Returns a function that takes these listeners off the process again. */
const setupShutdown = (servers: net.Server[], { reloadOnSighup, shutdownTimeout, reload, getLoaded, getInstances, logger }: ShutdownOptions): (() => void) => {
  const gracefulStop = createGracefulStop(servers, (timeout) => Promise.all(getLoaded().map(({ close }) => close(timeout))).then(() => undefined));
  const removeExitListeners = addExitListeners(logger, getInstances, {
    exitOnHangUp: !reloadOnSighup,
    gracefulStop: () => gracefulStop(shutdownTimeout),
  });
  if (reloadOnSighup) process.on('SIGHUP', reload);

  return () => {
    removeExitListeners();
    process.off('SIGHUP', reload);
  };
};

export default setupShutdown;
